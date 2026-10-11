/**
 * Docker execution sandbox (spec §9). Repo code never runs on the host.
 *  - One container per run, from SANDBOX_IMAGE, operating on a *copy* of the snapshot.
 *  - Phase 1 (install): network allowed, 5 min.
 *  - Phase 2 (build/test/lint + agent run_command): --network none, 10 min total, 120 s per agent command.
 *  - Always: --cpus 2 --memory 2g --pids-limit 256, non-root, read-only root fs, tmpfs work dirs,
 *    no Docker socket, all capabilities dropped, no-new-privileges.
 */
import { spawn } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { env } from "../env";
import { emitRunEvent } from "../events";
import type { RepoFacts } from "../ingest/index";
import { redactSecrets } from "../ingest/scanners";
import { walkRepo } from "../ingest/walk";
import type { ExecutionSummary } from "../llm/prompts/grader";
import { detectCommands } from "./detect";

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const PHASE2_BUDGET_MS = 10 * 60_000;
const AGENT_CMD_TIMEOUT_MS = 120_000;
const TAIL_LINES = 200;

export const containerName = (runId: string) => `rj-${runId}`.toLowerCase().replace(/[^a-z0-9_.-]/g, "");

/** Hardened `docker run` arguments. Pure; unit-tested. */
export function dockerRunArgs(input: {
  name: string;
  workDir: string;
  image: string;
  network: "bridge" | "none";
  command: string[];
}) {
  return [
    "run",
    "--rm",
    "--name",
    input.name,
    "--network",
    input.network,
    "--cpus",
    "2",
    "--memory",
    "2g",
    "--memory-swap",
    "2g",
    "--pids-limit",
    "256",
    "--user",
    "1000:1000",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,size=1g",
    "--tmpfs",
    "/home/sandbox:rw,exec,nosuid,size=1g",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "-e",
    "HOME=/home/sandbox",
    "-e",
    "CI=true",
    "-v",
    `${input.workDir}:/work:rw`,
    "-w",
    "/work",
    input.image,
    ...input.command,
  ];
}

export function tail(text: string, lines = TAIL_LINES): string {
  const all = text.split(/\r?\n/);
  return redactSecrets(all.slice(-lines).join("\n")).slice(-20_000);
}

function docker(args: string[], timeoutMs: number, signal?: AbortSignal) {
  return new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
  }>((resolve, reject) => {
    const started = Date.now();
    const child = spawn("docker", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = (s: string, d: Buffer) =>
      (s.length > 2_000_000 ? s.slice(-1_000_000) : s) + d.toString("utf8");
    child.stdout.on("data", (d: Buffer) => (stdout = cap(stdout, d)));
    child.stderr.on("data", (d: Buffer) => (stderr = cap(stderr, d)));
    const kill = () => {
      timedOut = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(kill, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      });
    });
  });
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    const r = await docker(["version", "--format", "{{.Server.Version}}"], 10_000);
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

function workDirFor(runId: string) {
  return path.resolve(env().STORAGE_DIR, "sandbox", runId);
}

/** Copy the snapshot (without .git) so the container can never modify the cached snapshot. */
async function prepareCopy(root: string, runId: string) {
  const dest = workDirFor(runId);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  for (const e of await readdir(root, { withFileTypes: true })) {
    if (e.name === ".git" || e.isSymbolicLink()) continue;
    await cp(path.join(root, e.name), path.join(dest, e.name), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
  }
  return dest;
}

async function record(runId: string, r: ExecutionSummary) {
  await db.executionResult.create({ data: { runId, ...r } });
  await emitRunEvent({
    runId,
    type: r.exitCode === 0 ? "tool" : "warning",
    label: `${r.phase}: ${r.command.slice(0, 80)} → exit ${r.exitCode} (${(r.durationMs / 1000).toFixed(1)}s)`,
    payload: { phase: r.phase, exitCode: r.exitCode },
  });
}

/** Run install (networked) then build/test/lint (offline) and keep an offline container for run_command. */
export async function runExecution(input: {
  runId: string;
  root: string;
  facts: RepoFacts;
  signal: AbortSignal;
}): Promise<ExecutionSummary[]> {
  if (!(await dockerAvailable())) throw new Error("Docker is not available to the worker");
  const image = env().SANDBOX_IMAGE;
  const work = await prepareCopy(input.root, input.runId);
  const walked = await walkRepo(work, { maxFiles: 100_000, maxBytes: 4e9 });
  const plan = detectCommands(input.facts, new Set(walked.files.map((f) => f.path)));
  await db.executionResult.deleteMany({ where: { runId: input.runId } });
  const results: ExecutionSummary[] = [];
  if (plan.length === 0) {
    await emitRunEvent({
      runId: input.runId,
      type: "note",
      label: "No build or test commands detected",
      payload: {},
    });
    return results;
  }

  // Phase 1: install with network (package registries), one container per command.
  for (const p of plan.filter((x) => x.phase === "install")) {
    const r = await docker(
      dockerRunArgs({
        name: `${containerName(input.runId)}-install`,
        workDir: work,
        image,
        network: "bridge",
        command: ["sh", "-lc", `cd ${shellQuote(p.cwd)} && ${p.command}`],
      }),
      INSTALL_TIMEOUT_MS,
      input.signal,
    );
    const s = {
      phase: p.phase,
      command: p.command,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      stdoutTail: tail(r.stdout),
      stderrTail: tail(r.stderr) + (r.timedOut ? "\n[timed out after 5 min]" : ""),
    };
    results.push(s);
    await record(input.runId, s);
  }

  // Phase 2: long-lived offline container; build/test/lint and later the agent's run_command use it.
  const name = containerName(input.runId);
  await docker(["rm", "-f", name], 30_000).catch(() => null);
  const started = await docker(
    dockerRunArgs({ name, workDir: work, image, network: "none", command: ["sleep", "1800"] }).map((a) =>
      a === "--rm" ? "-d" : a,
    ),
    60_000,
  );
  if (started.exitCode !== 0)
    throw new Error(`Could not start sandbox container: ${started.stderr.slice(0, 300)}`);

  const deadline = Date.now() + PHASE2_BUDGET_MS;
  for (const p of plan.filter((x) => x.phase !== "install")) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const s = {
        phase: p.phase,
        command: p.command,
        exitCode: 124,
        durationMs: 0,
        stdoutTail: "",
        stderrTail: "[skipped: 10-minute execution budget used up]",
      };
      results.push(s);
      await record(input.runId, s);
      continue;
    }
    const r = await docker(
      ["exec", "-w", "/work", name, "sh", "-lc", `cd ${shellQuote(p.cwd)} && ${p.command}`],
      remaining,
      input.signal,
    );
    const s = {
      phase: p.phase,
      command: p.command,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      stdoutTail: tail(r.stdout),
      stderrTail: tail(r.stderr) + (r.timedOut ? "\n[timed out]" : ""),
    };
    results.push(s);
    await record(input.runId, s);
  }
  return results;
}

/** The agent's run_command: same offline container, 120 s timeout. */
export async function runAgentCommand(input: {
  runId: string;
  root: string;
  command: string;
}): Promise<string> {
  const r = await docker(
    ["exec", "-w", "/work", containerName(input.runId), "sh", "-lc", input.command],
    AGENT_CMD_TIMEOUT_MS,
  ).catch((err: Error) => ({ exitCode: 1, stdout: "", stderr: err.message, durationMs: 0, timedOut: false }));
  await db.executionResult.create({
    data: {
      runId: input.runId,
      phase: "agent",
      command: input.command.slice(0, 500),
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      stdoutTail: tail(r.stdout),
      stderrTail: tail(r.stderr),
    },
  });
  return `exit ${r.exitCode}${r.timedOut ? " (timed out after 120 s)" : ""}\n${tail(`${r.stdout}\n${r.stderr}`, 120)}`;
}

/** Remove the run's container and work copy. Safe to call when nothing exists. */
export async function stopSandbox(runId: string) {
  await docker(["rm", "-f", containerName(runId)], 30_000).catch(() => null);
  await rm(workDirFor(runId), { recursive: true, force: true }).catch(() => null);
}

export function shellQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

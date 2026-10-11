/**
 * Phase 6 acceptance check (needs Docker + the sandbox image):
 *   pnpm sandbox:build && pnpm sandbox:smoke
 * Runs the Node and Python fixtures' tests in the sandbox, then proves that phase 2 has no
 * network and that CPU/memory/pids limits and the read-only root fs are enforced.
 */
import { spawnSync } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { indexRepo } from "../src/lib/ingest/index";
import { dockerAvailable, dockerRunArgs } from "../src/lib/sandbox/docker";
import { detectCommands } from "../src/lib/sandbox/detect";
import { walkRepo } from "../src/lib/ingest/walk";

const image = process.env.SANDBOX_IMAGE ?? "repojudge-sandbox:latest";

function run(args: string[], timeoutMs = 300_000) {
  const r = spawnSync("docker", args, { encoding: "utf8", timeout: timeoutMs });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

async function fixture(name: string) {
  const root = path.resolve("fixtures/repos", name);
  const facts = await indexRepo(
    root,
    { url: `fixture:${name}`, commitSha: "fixture" },
    { maxFiles: 10_000, maxBytes: 1e9 },
  );
  const files = new Set((await walkRepo(root, { maxFiles: 10_000, maxBytes: 1e9 })).files.map((f) => f.path));
  const plan = detectCommands(facts, files);
  console.log(`\n== ${name}: ${plan.map((p) => `${p.phase}: ${p.command}`).join(" | ")}`);
  // Work on a temp copy so installs never touch the committed fixture.
  const work = (await mkdtemp(path.join(os.tmpdir(), `rj-smoke-${name}-`))).replace(/\\/g, "/");
  await cp(root, work, { recursive: true });
  for (const p of plan) {
    const network = p.phase === "install" ? "bridge" : "none";
    const r = run(
      dockerRunArgs({
        name: `rj-smoke-${name}-${p.phase}`,
        workDir: work,
        image,
        network,
        command: ["sh", "-lc", p.command],
      }),
    );
    console.log(`${p.phase.padEnd(7)} exit ${r.code}  ${r.out.split("\n").slice(-3).join(" / ")}`);
    if (p.phase === "test" && r.code !== 0) process.exitCode = 1;
  }
}

async function main() {
  if (!(await dockerAvailable())) {
    console.error("Docker is not available. Install Docker and build the image (pnpm sandbox:build) first.");
    process.exit(2);
  }
  await fixture("node-tested");
  await fixture("clean-tested");

  console.log("\n== isolation checks (phase-2 settings)");
  const check = (label: string, cmd: string, expectFail: boolean) => {
    const r = run(
      dockerRunArgs({
        name: `rj-smoke-${label}`,
        workDir: path.resolve("fixtures/repos/node-tested").replace(/\\/g, "/"),
        image,
        network: "none",
        command: ["sh", "-lc", cmd],
      }),
      60_000,
    );
    const ok = expectFail ? r.code !== 0 : r.code === 0;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}: exit ${r.code} ${r.out.split("\n").slice(-1)[0] ?? ""}`);
    if (!ok) process.exitCode = 1;
  };
  check("no network", "curl -sS -m 5 https://registry.npmjs.org/ > /dev/null", true);
  check("read-only root fs", "touch /usr/should-fail", true);
  check("memory limit is 2g", 'test "$(cat /sys/fs/cgroup/memory.max)" = "2147483648"', false);
  check("pids limit is 256", 'test "$(cat /sys/fs/cgroup/pids.max)" = "256"', false);
  check("cpu limit is 2", 'test "$(cut -d" " -f1 /sys/fs/cgroup/cpu.max)" = "200000"', false);
  check("runs as non-root", 'test "$(id -u)" = "1000"', false);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Read-only repository tools for the grading agent (spec §5.2). Every path is confined to the
 * snapshot root by resolving real paths — `..`, absolute paths and symlink escapes are rejected.
 * Output is redacted for secrets before it can reach the model.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { open, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { rgPath } from "@vscode/ripgrep";
import { redactSecrets } from "../ingest/scanners";
import { EXCLUDED_DIRS, isExcludedPath } from "../ingest/walk";

const exec = promisify(execFile);

export const MAX_READ_LINES = 600;
const MAX_READ_BYTES = 1_500_000;

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

/** Normalize a model-supplied path to a POSIX path relative to the root. */
export function cleanRel(input: string): string {
  const p = (input ?? "").replace(/\\/g, "/").trim();
  if (p.includes("\0")) throw new ToolError("Invalid path.");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) {
    // Treat "/src/x" as repo-relative, but never allow drive letters.
    if (/^[a-zA-Z]:/.test(p)) throw new ToolError("Absolute paths are not allowed; use repo-relative paths.");
  }
  const parts = p.split("/").filter((s) => s && s !== ".");
  if (parts.some((s) => s === "..")) throw new ToolError("Paths may not contain '..'.");
  return parts.join("/");
}

/** Resolve inside the root, following symlinks only if they stay inside. */
export async function resolveInside(root: string, rel: string): Promise<{ abs: string; rel: string }> {
  const clean = cleanRel(rel);
  const realRoot = await realpath(root);
  const candidate = path.join(realRoot, clean);
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    throw new ToolError(`Not found: ${clean || "."}`);
  }
  const relToRoot = path.relative(realRoot, real);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot))
    throw new ToolError("Path escapes the repository.");
  return { abs: real, rel: relToRoot.split(path.sep).join("/") };
}

async function countLines(abs: string): Promise<number> {
  try {
    const t = await readFile(abs, "utf8");
    return t ? t.split(/\r?\n/).length - (t.endsWith("\n") ? 1 : 0) : 0;
  } catch {
    return 0;
  }
}

export async function listDir(root: string, rel: string, depth = 1): Promise<string> {
  const d = Math.min(3, Math.max(1, Math.floor(depth)));
  const { abs, rel: r } = await resolveInside(root, rel);
  if (!(await stat(abs)).isDirectory()) throw new ToolError(`${r} is a file; use read_file.`);
  const out: string[] = [`${r || "."}/`];
  let shown = 0;
  async function walk(dirAbs: string, dirRel: string, level: number, indent: string) {
    const entries = (await readdir(dirAbs, { withFileTypes: true })).sort((a, b) =>
      a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
    );
    for (const e of entries) {
      if (shown >= 400) {
        out.push(`${indent}… (listing truncated)`);
        return;
      }
      if (e.name === ".git" || e.isSymbolicLink()) continue;
      const childRel = dirRel ? `${dirRel}/${e.name}` : e.name;
      shown++;
      if (e.isDirectory()) {
        if (EXCLUDED_DIRS.has(e.name)) {
          out.push(`${indent}${e.name}/  (excluded: vendored/build)`);
          continue;
        }
        out.push(`${indent}${e.name}/`);
        if (level < d) await walk(path.join(dirAbs, e.name), childRel, level + 1, `${indent}  `);
      } else if (e.isFile()) {
        const st = await stat(path.join(dirAbs, e.name));
        const loc = st.size < MAX_READ_BYTES ? await countLines(path.join(dirAbs, e.name)) : null;
        out.push(
          `${indent}${e.name}  ${loc == null ? `(${Math.round(st.size / 1024)} KB)` : `${loc} lines`}`,
        );
      }
    }
  }
  await walk(abs, r, 1, "  ");
  return out.join("\n");
}

export type ReadResult = {
  text: string;
  rel: string;
  startLine: number;
  endLine: number;
  totalLines: number;
};

export async function readFileLines(
  root: string,
  rel: string,
  startLine?: number,
  endLine?: number,
): Promise<ReadResult> {
  const { abs, rel: r } = await resolveInside(root, rel);
  const st = await stat(abs);
  if (st.isDirectory()) throw new ToolError(`${r} is a directory; use list_dir.`);
  if (st.size > MAX_READ_BYTES)
    throw new ToolError(`${r} is too large to read (${Math.round(st.size / 1024)} KB). Use search_code.`);
  const fh = await open(abs, "r");
  try {
    const probe = Buffer.alloc(Math.min(8000, st.size));
    await fh.read(probe, 0, probe.length, 0);
    if (probe.includes(0)) throw new ToolError(`${r} is a binary file.`);
  } finally {
    await fh.close();
  }
  const lines = (await readFile(abs, "utf8")).split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  const total = lines.length;
  const start = Math.max(1, Math.floor(startLine ?? 1));
  if (total > 0 && start > total) throw new ToolError(`${r} has only ${total} lines.`);
  const end = Math.min(total, Math.floor(endLine ?? start + MAX_READ_LINES - 1), start + MAX_READ_LINES - 1);
  const width = String(end).length;
  const body = lines
    .slice(start - 1, end)
    .map(
      (l, i) => `${String(start + i).padStart(width, " ")}  ${l.length > 2000 ? `${l.slice(0, 2000)}…` : l}`,
    )
    .join("\n");
  const more = end < total ? `\n… (${total - end} more lines; call read_file with startLine=${end + 1})` : "";
  return {
    text: `${r} (lines ${start}–${end} of ${total})\n${redactSecrets(body)}${more}`,
    rel: r,
    startLine: start,
    endLine: end,
    totalLines: total,
  };
}

export async function searchCode(
  root: string,
  pattern: string,
  glob?: string,
  maxResults = 50,
): Promise<{ text: string; hits: { path: string; line: number }[] }> {
  const limit = Math.min(50, Math.max(1, Math.floor(maxResults)));
  if (!pattern || pattern.length > 500) throw new ToolError("Pattern must be 1–500 characters.");
  const args = [
    "--line-number",
    "--no-heading",
    "--color",
    "never",
    "--max-columns",
    "300",
    "--max-columns-preview",
    "--max-filesize",
    "1M",
    "--max-count",
    "20",
    "-S",
  ];
  for (const d of EXCLUDED_DIRS) args.push("--glob", `!**/${d}/**`);
  args.push("--glob", "!*.min.*", "--glob", "!*lock*");
  if (glob) args.push("--glob", cleanGlob(glob));
  args.push("-e", pattern, ".");
  let stdout = "";
  try {
    ({ stdout } = await exec(rgPath, args, {
      cwd: await realpath(root),
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }));
  } catch (err) {
    const e = err as { code?: number; stderr?: string; stdout?: string };
    if (e.code === 1) return { text: `No matches for /${pattern}/${glob ? ` in ${glob}` : ""}.`, hits: [] };
    if (e.code === 2 && e.stderr && /regex parse error/i.test(e.stderr))
      throw new ToolError(`Invalid regex: ${e.stderr.split("\n").slice(0, 3).join(" ")}`);
    stdout = e.stdout ?? "";
    if (!stdout) throw new ToolError("Search failed.");
  }
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const hits: { path: string; line: number }[] = [];
  const out: string[] = [];
  for (const l of lines) {
    const m = l.match(/^(?:\.[\\/])?(.+?):(\d+):(.*)$/);
    if (!m) continue;
    const p = m[1]!.replace(/\\/g, "/");
    if (isExcludedPath(p)) continue;
    hits.push({ path: p, line: Number(m[2]) });
    out.push(`${p}:${m[2]}: ${redactSecrets(m[3]!.trim())}`);
    if (hits.length >= limit) break;
  }
  const truncated =
    lines.length > hits.length ? `\n… (more matches not shown; narrow the pattern or glob)` : "";
  return { text: hits.length ? out.join("\n") + truncated : `No matches for /${pattern}/.`, hits };
}

function cleanGlob(glob: string): string {
  const g = glob.replace(/\\/g, "/").trim();
  if (g.includes("..") || g.startsWith("/") || g.startsWith("!")) throw new ToolError("Invalid glob.");
  return g;
}

export async function gitLog(root: string, limit = 20, rel?: string): Promise<string> {
  if (!existsSync(path.join(root, ".git")))
    return "No git history is available for this snapshot (ZIP upload).";
  const n = Math.min(50, Math.max(1, Math.floor(limit)));
  const args = [
    "log",
    "--no-color",
    "--date=iso-strict",
    "--format=%h %ad %an%n    %s",
    "--shortstat",
    "-n",
    String(n),
  ];
  if (rel) args.push("--", (await resolveInside(root, rel)).rel);
  try {
    const { stdout } = await exec("git", ["-c", "core.longpaths=true", ...args], {
      cwd: root,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return redactSecrets(stdout.trim()) || "No commits.";
  } catch {
    throw new ToolError("git log failed.");
  }
}

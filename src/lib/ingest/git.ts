import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export class GitError extends Error {
  constructor(
    message: string,
    public readonly code: "CLONE_FAILED" | "BAD_URL" | "NOT_FOUND" = "CLONE_FAILED",
  ) {
    super(message);
    this.name = "GitError";
  }
}

export type ParsedRepo = {
  sourceType: "github" | "git";
  /** Canonical clone URL (https, no credentials, no trailing .git for GitHub). */
  url: string;
  /** Stable key for snapshot caching. */
  sourceKey: string;
  owner?: string;
  repo?: string;
  /** Branch parsed from a /tree/<branch> URL, if any. */
  branch?: string;
};

/** Accepts GitHub URLs (incl. /tree/<branch>), `owner/repo` shorthand and generic https/ssh git URLs. */
export function parseRepoUrl(input: string): ParsedRepo {
  const raw = input.trim();
  if (!raw) throw new GitError("Empty repository URL", "BAD_URL");
  const short = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (short) return github(short[1]!, short[2]!);

  const ssh = raw.match(/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if (ssh) return github(ssh[1]!, ssh[2]!);

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new GitError(`Not a valid URL: ${raw}`, "BAD_URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new GitError("Only https:// git URLs (or GitHub SSH URLs) are supported", "BAD_URL");
  }
  if (u.username || u.password)
    throw new GitError("Remove credentials from the URL; connect GitHub instead", "BAD_URL");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1)/.test(u.hostname)) {
    throw new GitError("Private network hosts are not allowed", "BAD_URL");
  }
  if (u.hostname === "github.com" || u.hostname === "www.github.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new GitError("GitHub URL must include owner and repository", "BAD_URL");
    const parsed = github(parts[0]!, parts[1]!.replace(/\.git$/, ""));
    if (parts[2] === "tree" && parts.length > 3) parsed.branch = decodeURIComponent(parts.slice(3).join("/"));
    return parsed;
  }
  const clean = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  return { sourceType: "git", url: clean, sourceKey: `git:${clean.toLowerCase().replace(/\.git$/, "")}` };
}

function github(owner: string, repo: string): ParsedRepo {
  const r = repo.replace(/\.git$/, "");
  return {
    sourceType: "github",
    url: `https://github.com/${owner}/${r}`,
    sourceKey: `github:${owner.toLowerCase()}/${r.toLowerCase()}`,
    owner,
    repo: r,
  };
}

/** Git config args that inject a GitHub token without putting it in the URL, argv logs or .git/config. */
export function authArgs(token?: string | null): string[] {
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.extraHeader=Authorization: Basic ${basic}`];
}

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "echo",
  GCM_INTERACTIVE: "never",
  GIT_CONFIG_NOSYSTEM: "1",
};

export async function git(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; token?: string | null } = {},
) {
  try {
    const { stdout } = await exec("git", [...authArgs(opts.token), "-c", "core.longpaths=true", ...args], {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 120_000,
      maxBuffer: 64 * 1024 * 1024,
      env: GIT_ENV,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message: string; killed?: boolean };
    const detail = (e.stderr || e.message || "").replace(
      /Authorization: Basic \S+/g,
      "Authorization: Basic ***",
    );
    throw new GitError(e.killed ? "git timed out" : summarizeGitError(detail));
  }
}

function summarizeGitError(stderr: string): string {
  if (/Repository not found|not found|404/i.test(stderr)) {
    return "Repository not found. Check the URL, or connect GitHub if it is private.";
  }
  if (/Authentication failed|could not read Username|403/i.test(stderr)) {
    return "Access denied. Connect GitHub with access to this repository.";
  }
  if (/Could not resolve host|unable to access/i.test(stderr)) return "Network error reaching the git host.";
  return (
    stderr
      .split("\n")
      .find((l) => l.trim())
      ?.slice(0, 300) ?? "git failed"
  );
}

/** Resolve a branch (or HEAD) to a commit SHA without cloning. */
export async function resolveRef(url: string, branch: string | undefined, token?: string | null) {
  const out = await git(["ls-remote", "--symref", url, branch ? `refs/heads/${branch}` : "HEAD"], {
    timeoutMs: 30_000,
    token,
  });
  const lines = out.split("\n").filter(Boolean);
  const symref = lines.find((l) => l.startsWith("ref:"))?.match(/refs\/heads\/(\S+)/)?.[1];
  const shaLine = lines.find((l) => /^[0-9a-f]{40}\t/.test(l));
  if (!shaLine) {
    throw new GitError(branch ? `Branch “${branch}” not found` : "Repository has no commits", "NOT_FOUND");
  }
  return { sha: shaLine.slice(0, 40), branch: branch ?? symref ?? "HEAD" };
}

/**
 * Clone and check out an exact commit. Blobs over 2 MB are filtered (keeps big binaries out
 * while keeping history stats cheap). Symlinks are materialised as plain files.
 */
export async function cloneAt(url: string, sha: string, dir: string, token?: string | null) {
  await git(
    ["clone", "--filter=blob:limit=2m", "--no-checkout", "--quiet", "-c", "core.symlinks=false", url, dir],
    {
      timeoutMs: 300_000,
      token,
    },
  );
  await git(["-c", "core.symlinks=false", "checkout", "--quiet", "--force", sha], {
    cwd: dir,
    timeoutMs: 300_000,
    token,
  });
}

/** Last commit at or before `deadline` on the checked-out history, plus commits made after it. */
export async function commitAtDeadline(dir: string, ref: string, deadline: Date) {
  const iso = deadline.toISOString();
  const sha = (await git(["rev-list", "-1", `--before=${iso}`, ref], { cwd: dir })).trim();
  const after = Number((await git(["rev-list", "--count", `--since=${iso}`, ref], { cwd: dir })).trim()) || 0;
  return { sha: sha || null, commitsAfterDeadline: after };
}

export type GitFacts = {
  commits: number;
  authors: { name: string; commits: number }[];
  firstCommit: string;
  lastCommit: string;
  commitsAfterDeadline: number;
  largestCommitShare: number;
  messageSamples: string[];
};

/** History facts for the checked-out commit (spec RepoFacts.git). Returns null if no history. */
export async function gitFacts(dir: string, sha: string, deadline?: Date | null): Promise<GitFacts | null> {
  let log: string;
  try {
    log = await git(
      ["log", "--no-renames", "--format=@@%H%x09%an%x09%aI%x09%s", "--numstat", "-n", "2000", sha],
      {
        cwd: dir,
        timeoutMs: 120_000,
      },
    );
  } catch {
    return null;
  }
  const commits: { author: string; date: string; subject: string; changed: number }[] = [];
  for (const block of log.split("@@").filter(Boolean)) {
    const [head, ...rest] = block.split("\n");
    const [, author = "unknown", date = "", subject = ""] = head!.split("\t");
    let changed = 0;
    for (const l of rest) {
      const m = l.match(/^(\d+|-)\t(\d+|-)\t/);
      if (m) changed += (Number(m[1]) || 0) + (Number(m[2]) || 0);
    }
    commits.push({ author, date, subject, changed });
  }
  if (commits.length === 0) return null;
  const byAuthor = new Map<string, number>();
  for (const c of commits) byAuthor.set(c.author, (byAuthor.get(c.author) ?? 0) + 1);
  const totalChanged = commits.reduce((n, c) => n + c.changed, 0);
  const largest = Math.max(...commits.map((c) => c.changed));
  let after = 0;
  if (deadline) {
    try {
      after =
        Number(
          (
            await git(["rev-list", "--count", `--since=${deadline.toISOString()}`, "--all"], { cwd: dir })
          ).trim(),
        ) || 0;
    } catch {
      after = 0;
    }
  }
  const step = Math.max(1, Math.floor(commits.length / 15));
  return {
    commits: commits.length,
    authors: [...byAuthor.entries()]
      .map(([name, n]) => ({ name, commits: n }))
      .sort((a, b) => b.commits - a.commits),
    firstCommit: commits.at(-1)!.date,
    lastCommit: commits[0]!.date,
    commitsAfterDeadline: after,
    largestCommitShare: totalChanged ? Math.round((largest / totalChanged) * 100) / 100 : 0,
    messageSamples: commits
      .filter((_, i) => i % step === 0)
      .slice(0, 15)
      .map((c) => c.subject.slice(0, 120)),
  };
}

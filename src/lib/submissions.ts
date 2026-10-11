import { z } from "zod";
import { db } from "./db";
import { env } from "./env";
import { GitError, parseRepoUrl, resolveRef } from "./ingest/git";
import { sourceKeyFor, tokenForEvaluation } from "./ingest/fetch";

export const SubmissionItemSchema = z.object({
  repoUrl: z.string().trim().min(1).max(500),
  displayName: z.string().trim().max(120).optional().nullable(),
  teamName: z.string().trim().max(120).optional().nullable(),
  branch: z.string().trim().max(200).optional().nullable(),
});
export type SubmissionItem = z.infer<typeof SubmissionItemSchema>;

export type ValidatedRow = {
  index: number;
  input: SubmissionItem;
  status: "ok" | "error" | "duplicate";
  message?: string;
  sourceType?: "github" | "git";
  url?: string;
  sourceKey?: string;
  branch?: string;
  commitSha?: string;
  displayName?: string;
  teamName?: string | null;
  sizeKb?: number | null;
};

async function githubSizeKb(owner: string, repo: string, token: string | null): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "RepoJudge",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { size?: number };
    return typeof data.size === "number" ? data.size : null;
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

/** Validate rows: URL shape, reachability, branch → SHA, size, duplicates (spec §11.2 step 5). */
export async function validateItems(evaluationId: string, items: SubmissionItem[]): Promise<ValidatedRow[]> {
  const token = await tokenForEvaluation(evaluationId);
  const existing = await db.submission.findMany({
    where: { evaluationId },
    select: { sourceType: true, repoUrl: true, metadata: true, displayName: true },
  });
  const existingKeys = new Set(existing.map((s) => sourceKeyFor(s)));
  const seen = new Map<string, number>();
  const maxKb = env().MAX_REPO_MB * 1024;

  // Duplicate detection first (deterministic, before network calls).
  const parsed = items.map((input, index) => {
    try {
      const p = parseRepoUrl(input.repoUrl);
      const dupOf = seen.get(p.sourceKey);
      if (!seen.has(p.sourceKey)) seen.set(p.sourceKey, index);
      return {
        input,
        index,
        p,
        dup: existingKeys.has(p.sourceKey)
          ? "already in this evaluation"
          : dupOf !== undefined
            ? `same as row ${dupOf + 1}`
            : null,
      };
    } catch (err) {
      return { input, index, error: err instanceof GitError ? err.message : "Invalid URL" };
    }
  });

  return mapLimit(parsed, 4, async (row): Promise<ValidatedRow> => {
    if ("error" in row) return { index: row.index, input: row.input, status: "error", message: row.error };
    const { p, input, index } = row;
    const base = {
      index,
      input,
      sourceType: p.sourceType,
      url: p.url,
      sourceKey: p.sourceKey,
      displayName: input.displayName || (p.repo ?? p.url.split("/").pop() ?? p.url),
      teamName: input.teamName || null,
    };
    if (row.dup) return { ...base, status: "duplicate", message: `Duplicate: ${row.dup}` };
    try {
      const branch = input.branch || p.branch || undefined;
      const ref = await resolveRef(p.url, branch, token);
      const sizeKb = p.owner && p.repo ? await githubSizeKb(p.owner, p.repo, token) : null;
      if (sizeKb != null && sizeKb > maxKb) {
        return {
          ...base,
          status: "error",
          message: `Too large (${Math.round(sizeKb / 1024)} MB > ${env().MAX_REPO_MB} MB)`,
          sizeKb,
        };
      }
      return { ...base, status: "ok", branch: ref.branch, commitSha: ref.sha, sizeKb };
    } catch (err) {
      return {
        ...base,
        status: "error",
        message: err instanceof GitError ? err.message : "Could not reach repository",
      };
    }
  });
}

export async function createFromRows(evaluationId: string, rows: ValidatedRow[], userId: string) {
  const ok = rows.filter((r) => r.status === "ok");
  if (ok.length === 0) return [];
  return db.$transaction(
    ok.map((r) =>
      db.submission.create({
        data: {
          evaluationId,
          displayName: r.displayName!,
          teamName: r.teamName ?? null,
          sourceType: r.sourceType!,
          repoUrl: r.url!,
          branch: r.branch ?? null,
          commitSha: r.commitSha!,
          metadata: { addedById: userId, sizeKb: r.sizeKb ?? null },
        },
      }),
    ),
  );
}

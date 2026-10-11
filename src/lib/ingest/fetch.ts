import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import type { RepoSnapshot, Submission } from "@/generated/prisma/client";
import { decrypt } from "../crypto";
import { db } from "../db";
import { env } from "../env";
import { PipelineError } from "../errors";
import { storage } from "../storage";
import { cloneAt, commitAtDeadline, GitError, parseRepoUrl } from "./git";
import { indexRepo, type RepoFacts } from "./index";
import { RepoLimitError } from "./walk";
import { ArchiveError, extractZip } from "./zip";

export type SubmissionMeta = {
  zipSha256?: string;
  zipBytes?: number;
  headSha?: string;
  deadlineResolved?: boolean;
  commitsAfterDeadline?: number;
  addedById?: string;
};

export const readMeta = (s: Pick<Submission, "metadata">) => (s.metadata ?? {}) as SubmissionMeta;

export function limits() {
  const e = env();
  return { maxFiles: e.MAX_REPO_FILES, maxBytes: e.MAX_REPO_MB * 1024 * 1024 };
}

export function sourceKeyFor(s: Pick<Submission, "sourceType" | "repoUrl" | "metadata">): string {
  if (s.sourceType === "zip") return `zip:${readMeta(s).zipSha256}`;
  return parseRepoUrl(s.repoUrl!).sourceKey;
}

const keyDir = (sourceKey: string) => createHash("sha256").update(sourceKey).digest("hex").slice(0, 20);
export const snapshotStorageKey = (sourceKey: string, sha: string) => `snapshots/${keyDir(sourceKey)}/${sha}`;

/** GitHub token for private repos: the evaluation owner's connection (decrypted on use only). */
export async function tokenForEvaluation(evaluationId: string): Promise<string | null> {
  const evaluation = await db.evaluation.findUnique({
    where: { id: evaluationId },
    select: { ownerId: true },
  });
  if (!evaluation) return null;
  const conn = await db.githubConnection.findFirst({
    where: { userId: evaluation.ownerId },
    orderBy: { createdAt: "desc" },
  });
  if (!conn) return null;
  try {
    return decrypt(conn.encryptedToken);
  } catch {
    return null;
  }
}

async function exists(p: string) {
  return stat(p).then(
    () => true,
    () => false,
  );
}

function wrap(err: unknown): never {
  if (err instanceof PipelineError) throw err;
  if (err instanceof RepoLimitError) throw new PipelineError("REPO_TOO_LARGE", err.message);
  if (err instanceof ArchiveError) throw new PipelineError("BAD_ARCHIVE", err.message);
  if (err instanceof GitError) throw new PipelineError("CLONE_FAILED", err.message);
  throw err;
}

/**
 * FETCHING: materialise the submission at its pinned commit. Reuses an existing snapshot for the
 * same (source, SHA). In deadline mode, re-pins to the last commit at or before the deadline.
 */
export async function fetchSnapshot(submission: Submission, opts: { deadline?: Date | null } = {}) {
  try {
    const sourceKey = sourceKeyFor(submission);
    let sha = submission.commitSha;
    const meta = readMeta(submission);

    if (submission.sourceType !== "zip" && opts.deadline && !meta.deadlineResolved) {
      const token = await tokenForEvaluation(submission.evaluationId);
      const headDir = storage().localPath(snapshotStorageKey(sourceKey, sha));
      if (!(await exists(headDir))) await cloneAt(parseRepoUrl(submission.repoUrl!).url, sha, headDir, token);
      const { sha: atDeadline, commitsAfterDeadline } = await commitAtDeadline(headDir, sha, opts.deadline);
      if (!atDeadline) throw new PipelineError("CLONE_FAILED", "No commits exist before the deadline.");
      sha = atDeadline;
      await db.submission.update({
        where: { id: submission.id },
        data: {
          commitSha: sha,
          metadata: { ...meta, headSha: submission.commitSha, deadlineResolved: true, commitsAfterDeadline },
        },
      });
    }

    const storageKey = snapshotStorageKey(sourceKey, sha);
    const dir = storage().localPath(storageKey);
    const cached = await db.repoSnapshot.findUnique({
      where: { sourceKey_commitSha: { sourceKey, commitSha: sha } },
    });
    if (cached && (await exists(dir))) return { snapshot: cached, dir, sha, sourceKey, reused: true };

    if (!(await exists(dir))) {
      if (submission.sourceType === "zip") {
        const buf = await storage().get(submission.zipKey!);
        await extractZip(buf, dir, limits());
      } else {
        const token = await tokenForEvaluation(submission.evaluationId);
        await cloneAt(parseRepoUrl(submission.repoUrl!).url, sha, dir, token);
      }
    }
    return { snapshot: cached, dir, sha, sourceKey, reused: false };
  } catch (err) {
    wrap(err);
  }
}

/** INDEXING: compute RepoFacts (deterministic) and persist the snapshot row. Cached per snapshot. */
export async function indexSnapshot(
  submission: Submission,
  fetched: { snapshot: RepoSnapshot | null; dir: string; sha: string; sourceKey: string },
  opts: { deadline?: Date | null } = {},
): Promise<{ snapshot: RepoSnapshot; facts: RepoFacts }> {
  if (fetched.snapshot?.facts && Object.keys(fetched.snapshot.facts as object).length > 0) {
    return { snapshot: fetched.snapshot, facts: fetched.snapshot.facts as unknown as RepoFacts };
  }
  let facts: RepoFacts;
  try {
    facts = await indexRepo(
      fetched.dir,
      {
        url: submission.repoUrl ?? `zip:${submission.displayName}`,
        commitSha: fetched.sha,
        branch: submission.branch ?? undefined,
        deadline: opts.deadline,
      },
      limits(),
    );
  } catch (err) {
    wrap(err);
  }
  if (facts.size.sourceFiles === 0)
    throw new PipelineError("EMPTY_REPO", "No source files after exclusions.");
  const snapshot = await db.repoSnapshot.upsert({
    where: { sourceKey_commitSha: { sourceKey: fetched.sourceKey, commitSha: fetched.sha } },
    update: { facts: facts as object },
    create: {
      sourceKey: fetched.sourceKey,
      commitSha: fetched.sha,
      storageKey: snapshotStorageKey(fetched.sourceKey, fetched.sha),
      facts: facts as object,
    },
  });
  return { snapshot, facts };
}

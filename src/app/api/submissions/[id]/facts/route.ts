import { ApiError, requireEvaluation, route } from "@/lib/api";
import { db } from "@/lib/db";
import { sourceKeyFor } from "@/lib/ingest/fetch";

/** Cached RepoFacts for the submission's pinned commit, if it has been indexed. */
export const GET = route<{ id: string }>(async ({ params, user }) => {
  const submission = await db.submission.findUnique({ where: { id: params.id } });
  if (!submission) throw new ApiError(404, "NOT_FOUND", "Submission not found.");
  await requireEvaluation(submission.evaluationId, user.id);
  const snapshot = await db.repoSnapshot.findUnique({
    where: { sourceKey_commitSha: { sourceKey: sourceKeyFor(submission), commitSha: submission.commitSha } },
  });
  return { indexed: !!snapshot, facts: snapshot?.facts ?? null, snapshotId: snapshot?.id ?? null };
});

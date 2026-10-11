import { ApiError, requireEvaluation, route } from "@/lib/api";
import { db } from "@/lib/db";
import { PipelineError } from "@/lib/errors";
import { fetchSnapshot, indexSnapshot } from "@/lib/ingest/fetch";

export const maxDuration = 300;

/**
 * Fetch + index one submission inline (no LLM, no cost) and return its RepoFacts.
 * Used by the facts debug panel; grading runs do the same work in the worker.
 */
export const POST = route<{ id: string }>(async ({ params, user }) => {
  const submission = await db.submission.findUnique({ where: { id: params.id } });
  if (!submission) throw new ApiError(404, "NOT_FOUND", "Submission not found.");
  const { evaluation } = await requireEvaluation(submission.evaluationId, user.id, "judge");
  const settings = (evaluation.settings ?? {}) as { deadlineMode?: boolean };
  const deadline = settings.deadlineMode ? evaluation.deadline : null;
  try {
    const fetched = await fetchSnapshot(submission, { deadline });
    const fresh = await db.submission.findUniqueOrThrow({ where: { id: submission.id } });
    const { snapshot, facts } = await indexSnapshot(fresh, fetched, { deadline });
    return { snapshotId: snapshot.id, reused: fetched.reused, facts };
  } catch (err) {
    if (err instanceof PipelineError) throw new ApiError(422, err.code, err.message);
    throw err;
  }
});

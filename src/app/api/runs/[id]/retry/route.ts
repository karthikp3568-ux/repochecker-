import { ApiError, requireEvaluation, route } from "@/lib/api";
import { db } from "@/lib/db";
import { emitRunEvent } from "@/lib/events";
import { enqueueRun } from "@/lib/runs";

/** Retry a failed/cancelled/needs-review run. Resumes after its last completed stage (spec §14). */
export const POST = route<{ id: string }>(async ({ params, user }) => {
  const run = await db.run.findUnique({ where: { id: params.id }, include: { submission: true } });
  if (!run) throw new ApiError(404, "NOT_FOUND", "Run not found.");
  await requireEvaluation(run.submission.evaluationId, user.id, "judge");
  if (!["FAILED", "CANCELLED", "NEEDS_REVIEW"].includes(run.status)) {
    throw new ApiError(409, "NOT_RETRYABLE", "Only failed, cancelled or needs-review runs can be retried.");
  }
  // Needs-review runs regrade from scratch; failures resume after the last completed stage.
  const resumeFrom = run.status === "NEEDS_REVIEW" ? "INDEXING" : run.completedStage;
  const updated = await db.run.update({
    where: { id: run.id },
    data: {
      status: "QUEUED",
      statusReason: null,
      finishedAt: null,
      attempt: run.attempt + 1,
      completedStage: resumeFrom === "SCORING" || resumeFrom === "VERIFYING" ? "GRADING" : resumeFrom,
    },
  });
  await db.evaluation.update({ where: { id: run.submission.evaluationId }, data: { status: "running" } });
  await emitRunEvent({
    runId: run.id,
    type: "note",
    label: `Retry requested (attempt ${updated.attempt})`,
    payload: {},
  });
  await enqueueRun(run.id, updated.attempt);
  return { ok: true, attempt: updated.attempt };
});

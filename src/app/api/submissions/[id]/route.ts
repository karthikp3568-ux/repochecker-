import { ApiError, requireEvaluation, route } from "@/lib/api";
import { db } from "@/lib/db";

export const DELETE = route<{ id: string }>(async ({ params, user }) => {
  const submission = await db.submission.findUnique({ where: { id: params.id } });
  if (!submission) throw new ApiError(404, "NOT_FOUND", "Submission not found.");
  await requireEvaluation(submission.evaluationId, user.id, "judge");
  const active = await db.run.count({
    where: {
      submissionId: submission.id,
      status: { in: ["QUEUED", "FETCHING", "INDEXING", "EXECUTING", "GRADING", "VERIFYING", "SCORING"] },
    },
  });
  if (active > 0)
    throw new ApiError(409, "RUN_ACTIVE", "Cancel the running grade before deleting this submission.");
  await db.submission.delete({ where: { id: submission.id } });
  return { ok: true };
});

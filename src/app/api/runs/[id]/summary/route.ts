import { ApiError, requireEvaluation, route } from "@/lib/api";
import { db } from "@/lib/db";

/** Token/cost counters for the live drawer. */
export const GET = route<{ id: string }>(async ({ params, user }) => {
  const run = await db.run.findUnique({
    where: { id: params.id },
    include: { submission: { select: { evaluationId: true } } },
  });
  if (!run) throw new ApiError(404, "NOT_FOUND", "Run not found.");
  await requireEvaluation(run.submission.evaluationId, user.id);
  return [
    {
      id: run.id,
      status: run.status,
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      costUsd: run.costUsd,
      toolCalls: run.toolCalls,
    },
  ];
});

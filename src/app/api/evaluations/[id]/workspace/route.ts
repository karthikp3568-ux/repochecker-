import { requireEvaluation, route } from "@/lib/api";
import { workspaceData } from "@/lib/workspace";

/** Polled by the submissions table and overview while runs are active. */
export const GET = route<{ id: string }>(async ({ params, user }) => {
  const { evaluation } = await requireEvaluation(params.id, user.id);
  return {
    status: evaluation.status,
    ...(await workspaceData(evaluation.id, evaluation.activeRubricVersionId)),
  };
});

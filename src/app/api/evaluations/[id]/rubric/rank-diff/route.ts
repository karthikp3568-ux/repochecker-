import { ApiError, requireEvaluation, route } from "@/lib/api";
import { rankingDiff } from "@/lib/leaderboard";

/** Ranking movement between two rubric versions: ?from=<versionId>&to=<versionId>. */
export const GET = route<{ id: string }>(async ({ req, params, user }) => {
  const { evaluation } = await requireEvaluation(params.id, user.id);
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) throw new ApiError(400, "MISSING", "Provide from and to version ids.");
  return rankingDiff(evaluation.id, from, to);
});

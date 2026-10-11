import { ApiError, requireEvaluation, route } from "@/lib/api";
import { buildLeaderboard } from "@/lib/leaderboard";

export const GET = route<{ id: string }>(async ({ req, params, user }) => {
  const { evaluation } = await requireEvaluation(params.id, user.id);
  const versionId = new URL(req.url).searchParams.get("version") ?? evaluation.activeRubricVersionId;
  if (!versionId) throw new ApiError(409, "NO_RUBRIC", "No locked rubric yet.");
  const lb = await buildLeaderboard(evaluation.id, versionId);
  const strip = (e: (typeof lb.ranked)[number]) => {
    const { result: _r, ...rest } = e;
    return rest;
  };
  return {
    version: lb.version,
    ranked: lb.ranked.map(strip),
    unranked: lb.unranked.map(strip),
    disqualified: lb.disqualified.map(strip),
  };
});

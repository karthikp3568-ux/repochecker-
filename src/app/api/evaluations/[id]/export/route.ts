import { ApiError, requireEvaluation, route } from "@/lib/api";
import { buildLeaderboard, toCsv } from "@/lib/leaderboard";

/** Leaderboard export: ?format=csv|json (&version=…). */
export const GET = route<{ id: string }>(async ({ req, params, user }) => {
  const { evaluation } = await requireEvaluation(params.id, user.id);
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "csv";
  const versionId = url.searchParams.get("version") ?? evaluation.activeRubricVersionId;
  if (!versionId) throw new ApiError(409, "NO_RUBRIC", "No locked rubric yet.");
  const lb = await buildLeaderboard(evaluation.id, versionId);
  const all = [...lb.ranked, ...lb.unranked, ...lb.disqualified];
  const base = `${evaluation.name.replace(/[^\w.-]+/g, "_")}-v${lb.version.version}`;
  if (format === "json") {
    const body = {
      evaluation: { id: evaluation.id, name: evaluation.name },
      rubricVersion: lb.version.version,
      exportedAt: new Date().toISOString(),
      criteria: lb.rubric.criteria.map((c) => ({ id: c.id, name: c.name, type: c.type, weight: c.weight })),
      entries: all.map(({ result: _r, ...e }) => e),
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${base}.json"`,
      },
    });
  }
  if (format !== "csv") throw new ApiError(400, "BAD_FORMAT", "format must be csv or json");
  return new Response(toCsv(lb.rubric, all), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${base}.csv"`,
    },
  });
});

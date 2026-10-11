import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError, parseBody, requireEvaluation, route } from "@/lib/api";
import { AUX_EFFORT } from "@/lib/config";
import { db } from "@/lib/db";
import { buildLeaderboard } from "@/lib/leaderboard";
import { llm } from "@/lib/llm/client";
import { COMPARE_SYSTEM, CompareOutputSchema, type CompareOutput } from "@/lib/llm/prompts/compare";
import { rateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";
import { renderRubric } from "@/lib/rubric/render";
import type { MergedCriterion } from "@/lib/report";

const BodySchema = z.object({ reportIds: z.array(z.string()).min(2).max(4) });
const CACHE_TTL = 7 * 24 * 3600;

/** "Why A ranks above B" (Appendix E). Cached per (reports, their last update). */
export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const { reportIds } = await parseBody(req, BodySchema);
  const { evaluation } = await requireEvaluation(params.id, user.id);
  const reports = await db.report.findMany({
    where: { id: { in: reportIds }, submission: { evaluationId: evaluation.id } },
  });
  if (reports.length !== reportIds.length)
    throw new ApiError(404, "NOT_FOUND", "Some reports were not found.");
  const versions = new Set(reports.map((r) => r.rubricVersionId));
  if (versions.size !== 1)
    throw new ApiError(400, "MIXED_VERSIONS", "Compare reports graded with the same rubric version.");

  const key = `compare:${createHash("sha256")
    .update(
      reports
        .map((r) => `${r.id}@${r.updatedAt.toISOString()}`)
        .sort()
        .join("|"),
    )
    .digest("hex")}`;
  const cached = await redis()
    .get(key)
    .catch(() => null);
  if (cached) return { ...(JSON.parse(cached) as CompareOutput), cached: true };

  await rateLimit(user.id, "compare");
  const lb = await buildLeaderboard(evaluation.id, reports[0]!.rubricVersionId);
  const entries = [...lb.ranked, ...lb.unranked, ...lb.disqualified].filter((e) =>
    reportIds.includes(e.reportId),
  );
  entries.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const material = entries
    .map((e) => {
      const merged = (reports.find((r) => r.id === e.reportId)?.criteria ??
        []) as unknown as MergedCriterion[];
      return [
        `## ${e.name} — rank ${e.rank ?? (e.disqualified ? "DQ" : "unranked")}, overall ${e.overall ?? "—"} (${e.letter ?? "—"})`,
        ...lb.rubric.criteria.map((c) => {
          const cell = e.cells[c.id];
          const m = merged.find((x) => x.criterionId === c.id);
          return `- [${c.id}] ${c.name} (weight ${c.weight}): ${c.type === "gate" ? (cell?.gate ?? "—") : (cell?.score ?? "—")} — ${m?.rationale ?? "no rationale"}`;
        }),
      ].join("\n");
    })
    .join("\n\n");
  const { data } = await llm().structured({
    task: "compare",
    system: COMPARE_SYSTEM,
    user: `<rubric>\n${renderRubric(lb.rubric)}\n</rubric>\n\n<submissions>\n${material}\n</submissions>`,
    schema: CompareOutputSchema,
    effort: AUX_EFFORT,
    maxTokens: 8000,
  });
  await redis()
    .set(key, JSON.stringify(data), "EX", CACHE_TTL)
    .catch(() => {});
  return { ...data, cached: false };
});

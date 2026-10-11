import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api";
import { db } from "@/lib/db";
import { recomputeReport } from "@/lib/report";
import { requireReport } from "@/lib/report-access";

const BodySchema = z.object({
  criterionId: z.string().min(1),
  score: z.number().finite(),
  note: z.string().trim().max(2000).nullable().optional(),
});

/** Score a human-scored criterion (demo, pitch…). Append-only; latest wins. */
export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, BodySchema);
  const { report, rubric } = await requireReport(params.id, user.id, "judge");
  const c = rubric.criteria.find((x) => x.id === body.criterionId);
  if (!c) throw new ApiError(400, "UNKNOWN_CRITERION", "Unknown criterion.");
  if (c.scorer !== "human")
    throw new ApiError(400, "NOT_HUMAN", `${c.name} is AI-scored; use an override instead.`);
  const [min, max] =
    c.type === "gate"
      ? [0, 1]
      : c.type === "bonus"
        ? [0, c.bonusMax ?? 0]
        : [rubric.scale.min, rubric.scale.max];
  if (body.score < min || body.score > max)
    throw new ApiError(400, "OUT_OF_RANGE", `Score must be between ${min} and ${max}.`);
  await db.humanScore.create({
    data: {
      reportId: report.id,
      criterionId: c.id,
      score: body.score,
      note: body.note ?? null,
      userId: user.id,
    },
  });
  if (report.status === "approved") {
    await db.report.update({
      where: { id: report.id },
      data: { status: "draft", approvedById: null, approvedAt: null },
    });
  }
  const result = await recomputeReport(report.id);
  return { ok: true, finalOverall: result.overall };
});

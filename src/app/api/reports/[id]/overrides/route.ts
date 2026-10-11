import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api";
import { db } from "@/lib/db";
import { recomputeReport, type MergedCriterion } from "@/lib/report";
import { requireReport } from "@/lib/report-access";

const BodySchema = z.object({
  criterionId: z.string().min(1),
  newScore: z.number().finite(),
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(2000),
});

/** Judge override. Append-only audit row; approval is cleared because the result changed. */
export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, BodySchema);
  const { report, rubric } = await requireReport(params.id, user.id, "judge");
  const c = rubric.criteria.find((x) => x.id === body.criterionId);
  if (!c) throw new ApiError(400, "UNKNOWN_CRITERION", "Unknown criterion.");
  const [min, max] =
    c.type === "gate"
      ? [0, 1]
      : c.type === "bonus"
        ? [0, c.bonusMax ?? 0]
        : [rubric.scale.min, rubric.scale.max];
  if (body.newScore < min || body.newScore > max)
    throw new ApiError(400, "OUT_OF_RANGE", `Score must be between ${min} and ${max}.`);

  const merged = ((report.criteria ?? []) as unknown as MergedCriterion[]).find(
    (m) => m.criterionId === c.id,
  );
  const prior = await db.scoreOverride.findFirst({
    where: { reportId: report.id, criterionId: c.id },
    orderBy: { createdAt: "desc" },
  });
  const aiScore =
    c.type === "gate"
      ? merged?.status === "gate_pass"
        ? 1
        : merged?.status === "gate_fail"
          ? 0
          : null
      : (merged?.score ?? null);
  await db.scoreOverride.create({
    data: {
      reportId: report.id,
      criterionId: c.id,
      aiScore: prior ? prior.newScore : aiScore,
      newScore: body.newScore,
      reason: body.reason,
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
  return { ok: true, finalOverall: result.overall, percent: result.percent, letter: result.letter };
});

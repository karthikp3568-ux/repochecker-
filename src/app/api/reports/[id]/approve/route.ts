import { ApiError, route } from "@/lib/api";
import { db } from "@/lib/db";
import { recomputeReport } from "@/lib/report";
import { requireReport } from "@/lib/report-access";

/** Human approval: the final say. Requires every human-scored criterion to have a score. */
export const POST = route<{ id: string }>(async ({ params, user }) => {
  const { report, rubric } = await requireReport(params.id, user.id, "judge");
  if (report.status === "approved") return { ok: true };
  const result = await recomputeReport(report.id);
  if (result.disqualified)
    throw new ApiError(409, "DISQUALIFIED", "A disqualifying gate failed. Override the gate to approve.");
  const human = await db.humanScore.findMany({
    where: { reportId: report.id },
    select: { criterionId: true },
  });
  const overrides = await db.scoreOverride.findMany({
    where: { reportId: report.id },
    select: { criterionId: true },
  });
  const pending = rubric.criteria.filter(
    (c) =>
      c.scorer === "human" &&
      !human.some((h) => h.criterionId === c.id) &&
      !overrides.some((o) => o.criterionId === c.id),
  );
  if (pending.length)
    throw new ApiError(
      409,
      "HUMAN_SCORES_PENDING",
      `Score these human criteria first: ${pending.map((c) => c.name).join(", ")}.`,
    );
  await db.report.update({
    where: { id: report.id },
    data: { status: "approved", approvedById: user.id, approvedAt: new Date() },
  });
  return { ok: true };
});

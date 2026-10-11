import type { MemberRole } from "@/generated/prisma/client";
import { ApiError, requireEvaluation } from "./api";
import { db } from "./db";
import { RubricSchema } from "./rubric/schema";

/** Load a report and check the caller's role on its evaluation. */
export async function requireReport(reportId: string, userId: string, min: MemberRole = "viewer") {
  const report = await db.report.findUnique({
    where: { id: reportId },
    include: { submission: true, rubricVersion: true },
  });
  if (!report) throw new ApiError(404, "NOT_FOUND", "Report not found.");
  const { evaluation, role } = await requireEvaluation(report.submission.evaluationId, userId, min);
  const rubric = RubricSchema.parse(report.rubricVersion.rubric);
  return { report, evaluation, role, rubric };
}

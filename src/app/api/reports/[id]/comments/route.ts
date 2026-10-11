import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api";
import { db } from "@/lib/db";
import { requireReport } from "@/lib/report-access";

const BodySchema = z.object({
  body: z.string().trim().min(1).max(4000),
  criterionId: z.string().nullable().optional(),
});

export const GET = route<{ id: string }>(async ({ params, user }) => {
  await requireReport(params.id, user.id);
  return db.comment.findMany({
    where: { reportId: params.id },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { name: true, email: true } } },
  });
});

export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, BodySchema);
  const { report, rubric } = await requireReport(params.id, user.id, "judge");
  if (body.criterionId && !rubric.criteria.some((c) => c.id === body.criterionId)) {
    throw new ApiError(400, "UNKNOWN_CRITERION", "Unknown criterion.");
  }
  const comment = await db.comment.create({
    data: { reportId: report.id, criterionId: body.criterionId ?? null, userId: user.id, body: body.body },
  });
  return Response.json(comment, { status: 201 });
});

import { z } from "zod";
import { parseBody, route } from "@/lib/api";
import { db } from "@/lib/db";
import { SettingsSchema } from "@/lib/evaluation";
import { ContextSchema, PURPOSES } from "@/lib/rubric/schema";

const CreateEvaluationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  purpose: z.enum(PURPOSES),
  context: ContextSchema.default(ContextSchema.parse({})),
});

export const POST = route(async ({ req, user }) => {
  const body = await parseBody(req, CreateEvaluationSchema);
  const evaluation = await db.evaluation.create({
    data: {
      ownerId: user.id,
      name: body.name,
      purpose: body.purpose,
      context: body.context,
      settings: SettingsSchema.parse({}),
      deadline: body.context.deadline ? new Date(body.context.deadline) : null,
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  return Response.json(evaluation, { status: 201 });
});

export const GET = route(async ({ user }) => {
  return db.evaluation.findMany({
    where: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { submissions: true } } },
  });
});

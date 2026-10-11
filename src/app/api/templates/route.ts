import { z } from "zod";
import { parseBody, route } from "@/lib/api";
import { db } from "@/lib/db";
import { RubricSchema } from "@/lib/rubric/schema";

export const GET = route(async ({ user }) =>
  db.rubricTemplate.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" } }),
);

const BodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  rubric: RubricSchema,
});

export const POST = route(async ({ req, user }) => {
  const body = await parseBody(req, BodySchema);
  const template = await db.rubricTemplate.create({ data: { ownerId: user.id, ...body } });
  return Response.json(template, { status: 201 });
});

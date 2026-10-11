import { z } from "zod";
import { ApiError, parseBody, requireEvaluation, route } from "@/lib/api";
import { db } from "@/lib/db";

export const GET = route<{ id: string }>(async ({ params, user }) => {
  const { evaluation } = await requireEvaluation(params.id, user.id);
  const members = await db.evaluationMember.findMany({
    where: { evaluationId: evaluation.id },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return members.map((m) => ({
    userId: m.userId,
    role: m.userId === evaluation.ownerId ? "owner" : m.role,
    name: m.user.name,
    email: m.user.email,
  }));
});

const AddSchema = z.object({ email: z.string().trim().email(), role: z.enum(["judge", "viewer"]) });

/** Owners add judges/viewers by email. The person must have signed in at least once. */
export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, AddSchema);
  const { evaluation } = await requireEvaluation(params.id, user.id, "owner");
  const target =
    (await db.user.findUnique({ where: { email: body.email.toLowerCase() } })) ??
    (await db.user.findUnique({ where: { email: body.email } }));
  if (!target)
    throw new ApiError(
      404,
      "USER_NOT_FOUND",
      "No user with that email has signed in yet. Ask them to sign in first.",
    );
  if (target.id === evaluation.ownerId)
    throw new ApiError(400, "IS_OWNER", "That person already owns this evaluation.");
  await db.evaluationMember.upsert({
    where: { evaluationId_userId: { evaluationId: evaluation.id, userId: target.id } },
    update: { role: body.role },
    create: { evaluationId: evaluation.id, userId: target.id, role: body.role },
  });
  return { ok: true };
});

const RemoveSchema = z.object({ userId: z.string().min(1) });

export const DELETE = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, RemoveSchema);
  const { evaluation } = await requireEvaluation(params.id, user.id, "owner");
  if (body.userId === evaluation.ownerId) throw new ApiError(400, "IS_OWNER", "The owner can't be removed.");
  await db.evaluationMember.deleteMany({ where: { evaluationId: evaluation.id, userId: body.userId } });
  return { ok: true };
});

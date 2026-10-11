import type { MemberRole } from "@/generated/prisma/client";
import { notFound, redirect } from "next/navigation";
import { roleFor } from "./api";
import { requireUser } from "./auth";
import { db } from "./db";

const RANK: Record<MemberRole, number> = { viewer: 1, judge: 2, owner: 3 };

/** For server components: load an evaluation the signed-in user may see (404 otherwise). */
export async function loadEvaluationPage(id: string, min: MemberRole = "viewer") {
  const user = await requireUser();
  const evaluation = await db.evaluation.findUnique({ where: { id } });
  if (!evaluation) notFound();
  const role = await roleFor(evaluation, user.id);
  if (!role) notFound();
  if (RANK[role] < RANK[min]) redirect(`/app/evaluations/${id}`);
  return { user, evaluation, role, canEdit: RANK[role] >= RANK.judge };
}

export function hasRole(role: MemberRole, min: MemberRole) {
  return RANK[role] >= RANK[min];
}

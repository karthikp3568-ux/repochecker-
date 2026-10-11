import { ApiError, route } from "@/lib/api";
import { db } from "@/lib/db";

export const DELETE = route<{ id: string }>(async ({ params, user }) => {
  const { count } = await db.rubricTemplate.deleteMany({ where: { id: params.id, ownerId: user.id } });
  if (count === 0) throw new ApiError(404, "NOT_FOUND", "Template not found.");
  return { ok: true };
});

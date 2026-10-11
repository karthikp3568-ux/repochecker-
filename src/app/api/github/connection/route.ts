import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { githubConfigured } from "@/lib/github";

export const GET = route(async ({ user }) => {
  const conn = await db.githubConnection.findFirst({
    where: { userId: user.id },
    select: { scopes: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return {
    configured: githubConfigured(),
    connected: !!conn,
    scopes: conn?.scopes ?? null,
    connectedAt: conn?.createdAt ?? null,
  };
});

export const DELETE = route(async ({ user }) => {
  await db.githubConnection.deleteMany({ where: { userId: user.id } });
  return { ok: true };
});

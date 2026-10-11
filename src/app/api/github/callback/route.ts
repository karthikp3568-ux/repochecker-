import { cookies } from "next/headers";
import { ApiError, route } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { githubCallbackUrl } from "@/lib/github";

export const GET = route(async ({ req, user }) => {
  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const saved = JSON.parse(jar.get("gh_oauth")?.value ?? "null") as {
    state: string;
    returnTo: string;
  } | null;
  jar.delete("gh_oauth");
  if (!saved || saved.state !== params.get("state"))
    throw new ApiError(400, "BAD_STATE", "GitHub connection expired. Try again.");
  const code = params.get("code");
  if (!code) throw new ApiError(400, "DENIED", "GitHub access was not granted.");

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.AUTH_GITHUB_ID,
      client_secret: process.env.AUTH_GITHUB_SECRET,
      code,
      redirect_uri: githubCallbackUrl(),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string };
  if (!data.access_token) throw new ApiError(502, "GITHUB_ERROR", "GitHub did not return an access token.");

  await db.$transaction([
    db.githubConnection.deleteMany({ where: { userId: user.id } }),
    db.githubConnection.create({
      data: { userId: user.id, encryptedToken: encrypt(data.access_token), scopes: data.scope ?? "" },
    }),
  ]);
  return Response.redirect(new URL(saved.returnTo, env().APP_URL).toString(), 302);
});

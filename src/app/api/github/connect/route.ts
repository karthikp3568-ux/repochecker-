import { cookies } from "next/headers";
import { ApiError, route } from "@/lib/api";
import { randomToken } from "@/lib/crypto";
import { GITHUB_REPO_SCOPE, githubCallbackUrl, githubConfigured } from "@/lib/github";

/** Start the explicit "Connect GitHub for private repos" flow (requests `repo` scope). */
export const GET = route(async ({ req }) => {
  if (!githubConfigured())
    throw new ApiError(400, "GITHUB_NOT_CONFIGURED", "GitHub OAuth isn't configured on this server.");
  const returnTo = new URL(req.url).searchParams.get("returnTo") ?? "/app/settings";
  const state = randomToken(18);
  const jar = await cookies();
  jar.set(
    "gh_oauth",
    JSON.stringify({
      state,
      returnTo: returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/app",
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/",
    },
  );
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.AUTH_GITHUB_ID!);
  url.searchParams.set("redirect_uri", githubCallbackUrl());
  url.searchParams.set("scope", GITHUB_REPO_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  return Response.redirect(url.toString(), 302);
});

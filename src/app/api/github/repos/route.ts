import { ApiError, route } from "@/lib/api";
import { listUserRepos, userGithubToken } from "@/lib/github";

export const GET = route(async ({ req, user }) => {
  const token = await userGithubToken(user.id);
  if (!token) throw new ApiError(409, "GITHUB_NOT_CONNECTED", "Connect GitHub first.");
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    return await listUserRepos(token, q);
  } catch {
    throw new ApiError(502, "GITHUB_ERROR", "Couldn't load repositories from GitHub. Reconnect and retry.");
  }
});

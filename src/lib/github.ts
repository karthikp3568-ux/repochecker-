import { decrypt } from "./crypto";
import { db } from "./db";
import { env } from "./env";

export const GITHUB_REPO_SCOPE = "repo read:user";
export const githubConfigured = () => Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

/**
 * OAuth callback for the separate "Connect GitHub for private repos" step. It lives under
 * /api so a GitHub OAuth app whose callback URL is `${APP_URL}/api` serves both this and Auth.js.
 */
export const githubCallbackUrl = () => `${env().APP_URL}/api/github/callback`;

export async function userGithubToken(userId: string): Promise<string | null> {
  const conn = await db.githubConnection.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  if (!conn) return null;
  try {
    return decrypt(conn.encryptedToken);
  } catch {
    return null;
  }
}

export type GithubRepo = {
  fullName: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string;
  description: string | null;
};

export async function listUserRepos(token: string, query: string): Promise<GithubRepo[]> {
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "RepoJudge",
  };
  const res = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
    {
      headers,
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = (await res.json()) as {
    full_name: string;
    html_url: string;
    private: boolean;
    default_branch: string;
    pushed_at: string;
    description: string | null;
  }[];
  const q = query.trim().toLowerCase();
  return data
    .filter((r) => !q || r.full_name.toLowerCase().includes(q))
    .map((r) => ({
      fullName: r.full_name,
      url: r.html_url,
      private: r.private,
      defaultBranch: r.default_branch,
      pushedAt: r.pushed_at,
      description: r.description,
    }));
}

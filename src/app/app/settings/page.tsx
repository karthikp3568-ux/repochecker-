import type { Metadata } from "next";
import Link from "next/link";
import { GithubConnection } from "@/components/github-connection";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { githubConfigured } from "@/lib/github";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const [conn, evaluations] = await Promise.all([
    db.githubConnection.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { scopes: true, createdAt: true },
    }),
    db.evaluation.findMany({
      where: { ownerId: user.id },
      select: {
        id: true,
        name: true,
        createdAt: true,
        submissions: {
          select: { runs: { select: { costUsd: true, tokensIn: true, tokensOut: true, cacheRead: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const usage = evaluations.map((e) => {
    const runs = e.submissions.flatMap((s) => s.runs);
    return {
      id: e.id,
      name: e.name,
      runs: runs.length,
      cost: runs.reduce((n, r) => n + Number(r.costUsd), 0),
      tokens: runs.reduce((n, r) => n + r.tokensIn + r.tokensOut, 0),
      cacheRead: runs.reduce((n, r) => n + r.cacheRead, 0),
    };
  });
  const total = usage.reduce((n, u) => n + u.cost, 0);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <section className="border-border bg-card rounded-xl border p-5" aria-labelledby="profile-h">
        <h2 id="profile-h" className="font-semibold">
          Profile
        </h2>
        <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{user.name ?? "—"}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{user.email ?? "—"}</dd>
        </dl>
      </section>

      <section className="border-border bg-card rounded-xl border p-5" aria-labelledby="gh-h">
        <h2 id="gh-h" className="font-semibold">
          GitHub connection
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Used only to clone private repositories you submit. The token is encrypted at rest (AES-256-GCM).
        </p>
        <div className="mt-3">
          <GithubConnection
            configured={githubConfigured()}
            connected={!!conn}
            scopes={conn?.scopes ?? null}
            connectedAt={conn?.createdAt.toISOString() ?? null}
          />
        </div>
      </section>

      <section className="border-border bg-card rounded-xl border p-5" aria-labelledby="usage-h">
        <h2 id="usage-h" className="font-semibold">
          Usage and cost
        </h2>
        <p className="mt-1 text-sm">
          Total spent on your evaluations: <b>${total.toFixed(2)}</b>
        </p>
        {usage.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">No grading runs yet.</p>
        ) : (
          <div className="border-border relative mt-3 overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-muted/60 text-muted-foreground text-left text-xs">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Evaluation
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Runs
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Tokens
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Cache reads
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.id} className="border-border border-t">
                    <td className="px-3 py-2">
                      <Link href={`/app/evaluations/${u.id}`} className="hover:underline">
                        {u.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{u.runs}</td>
                    <td className="px-3 py-2 text-right font-mono">{(u.tokens / 1000).toFixed(0)}k</td>
                    <td className="px-3 py-2 text-right font-mono">{(u.cacheRead / 1000).toFixed(0)}k</td>
                    <td className="px-3 py-2 text-right font-mono">${u.cost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

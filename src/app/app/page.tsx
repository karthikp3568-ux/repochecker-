import { ClipboardList, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ProgressRing } from "@/components/progress-ring";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EvaluationStatus, Prisma } from "@/generated/prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Evaluations" };

const STATUSES: { value: EvaluationStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "rubric_ready", label: "Rubric ready" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

const PURPOSE_LABEL: Record<string, string> = {
  hackathon: "Hackathon",
  course: "Course",
  hiring: "Hiring",
  audit: "Audit",
  self_review: "Self-review",
  other: "Other",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await requireUser();
  const { q, status } = await searchParams;
  const statusFilter = STATUSES.find((s) => s.value === status)?.value;

  const where: Prisma.EvaluationWhereInput = {
    OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    ...(statusFilter ? { status: statusFilter } : { status: { not: "archived" } }),
  };

  const [evaluations, totalCount] = await Promise.all([
    db.evaluation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { submissions: true } } },
    }),
    db.evaluation.count({ where: { OR: where.OR } }),
  ]);

  // Report stats per evaluation, scoped to each evaluation's active rubric version.
  const reportStats = new Map<string, { graded: number; needsReview: number; avgPercent: number | null }>();
  const activeIds = evaluations.map((e) => e.activeRubricVersionId).filter((id): id is string => !!id);
  if (activeIds.length > 0) {
    const grouped = await db.report.groupBy({
      by: ["rubricVersionId", "status"],
      where: { rubricVersionId: { in: activeIds } },
      _count: { _all: true },
      _avg: { percent: true },
    });
    for (const ev of evaluations) {
      const rows = grouped.filter((g) => g.rubricVersionId === ev.activeRubricVersionId);
      const graded = rows.reduce((n, r) => n + r._count._all, 0);
      const scored = rows.filter((r) => r._avg.percent != null);
      const weight = scored.reduce((n, r) => n + r._count._all, 0);
      reportStats.set(ev.id, {
        graded,
        needsReview: rows.find((r) => r.status === "needs_review")?._count._all ?? 0,
        avgPercent: weight ? scored.reduce((s, r) => s + r._avg.percent! * r._count._all, 0) / weight : null,
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Evaluations</h1>
          <p className="text-muted-foreground text-sm">Grading projects you own or judge.</p>
        </div>
        <Link href="/app/evaluations/new" className={buttonVariants()}>
          <Plus aria-hidden /> New evaluation
        </Link>
      </div>

      {totalCount === 0 ? (
        <EmptyState />
      ) : (
        <>
          <form className="flex flex-wrap gap-2" role="search">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden
              />
              <Input
                name="q"
                defaultValue={q}
                placeholder="Search evaluations"
                aria-label="Search evaluations"
                className="pl-9"
              />
            </div>
            <select
              name="status"
              defaultValue={statusFilter ?? ""}
              aria-label="Filter by status"
              className="border-input bg-card h-10 rounded-lg border px-3 text-sm"
            >
              <option value="">Active</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonVariants({ variant: "secondary" })}>
              Apply
            </button>
          </form>

          {evaluations.length === 0 ? (
            <p className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
              No evaluations match these filters.
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {evaluations.map((ev) => {
                const stats = reportStats.get(ev.id);
                const total = ev._count.submissions;
                return (
                  <li key={ev.id}>
                    <Link
                      href={`/app/evaluations/${ev.id}`}
                      className="border-border bg-card hover:border-accent/50 flex h-full flex-col gap-4 rounded-xl border p-5 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate font-semibold">{ev.name}</h2>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <Badge tone="accent">{PURPOSE_LABEL[ev.purpose] ?? ev.purpose}</Badge>
                            <Badge>{STATUSES.find((s) => s.value === ev.status)?.label}</Badge>
                          </div>
                        </div>
                        <ProgressRing value={stats?.graded ?? 0} total={total} />
                      </div>
                      <dl className="mt-auto grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <dt className="text-muted-foreground text-xs">Repos</dt>
                          <dd className="font-medium">{total}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground text-xs">Avg score</dt>
                          <dd className="font-medium">
                            {stats?.avgPercent != null ? `${Math.round(stats.avgPercent)}%` : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground text-xs">Needs review</dt>
                          <dd className={stats?.needsReview ? "text-warning font-medium" : "font-medium"}>
                            {stats?.needsReview ?? 0}
                          </dd>
                        </div>
                      </dl>
                      <p className="text-muted-foreground text-xs">
                        Updated{" "}
                        <time dateTime={ev.updatedAt.toISOString()}>
                          {ev.updatedAt.toLocaleDateString("en", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </time>
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-border flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="bg-accent-subtle text-accent grid size-12 place-items-center rounded-xl">
        <ClipboardList className="size-6" aria-hidden />
      </span>
      <h2 className="mt-4 text-lg font-semibold">No evaluations yet</h2>
      <p className="text-muted-foreground mt-2 max-w-md text-sm">
        An evaluation is one grading project, like a hackathon final or a class assignment. Describe what you
        care about, review the rubric RepoJudge drafts, then add repositories to grade.
      </p>
      <Link href="/app/evaluations/new" className={buttonVariants({ className: "mt-6" })}>
        <Plus aria-hidden /> Start your first evaluation
      </Link>
    </div>
  );
}

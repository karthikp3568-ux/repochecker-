import { AlertTriangle, Flag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { ScoreHistogram } from "@/components/workspace/score-histogram";
import { buttonVariants } from "@/components/ui/button";
import { loadEvaluationPage } from "@/lib/access";
import { db } from "@/lib/db";
import { readSettings } from "@/lib/evaluation";
import { estimate } from "@/lib/estimate";
import { sourceKeyFor } from "@/lib/ingest/fetch";

export const metadata: Metadata = { title: "Overview" };

const BAR = [
  { key: "COMPLETED", label: "Completed", cls: "bg-success" },
  { key: "NEEDS_REVIEW", label: "Needs review", cls: "bg-warning" },
  { key: "ACTIVE", label: "In progress", cls: "bg-info" },
  { key: "FAILED", label: "Failed", cls: "bg-danger" },
  { key: "NOT_STARTED", label: "Not started", cls: "bg-muted-foreground/40" },
] as const;

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { evaluation, canEdit } = await loadEvaluationPage(id);
  if (!evaluation.activeRubricVersionId) {
    return (
      <div className="border-border flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
        <p className="font-medium">This evaluation has no locked rubric yet</p>
        <p className="text-muted-foreground mt-1 max-w-md text-sm">
          Describe what matters, review the rubric RepoJudge drafts, and lock it to start grading.
        </p>
        {canEdit && (
          <Link
            href={`/app/evaluations/${id}/setup/intent`}
            className={buttonVariants({ className: "mt-4" })}
          >
            Continue setup
          </Link>
        )}
      </div>
    );
  }

  const settings = readSettings(evaluation.settings);
  const submissions = await db.submission.findMany({ where: { evaluationId: id } });
  const runs = await db.run.findMany({
    where: { submission: { evaluationId: id } },
    orderBy: { createdAt: "desc" },
  });
  const reports = await db.report.findMany({
    where: { submission: { evaluationId: id }, rubricVersionId: evaluation.activeRubricVersionId },
    include: { submission: { select: { displayName: true } } },
  });
  const flags = await db.integrityFlag.groupBy({
    by: ["category", "severity"],
    where: { run: { submission: { evaluationId: id }, rubricVersionId: evaluation.activeRubricVersionId } },
    _count: { _all: true },
  });

  // Latest group status per submission.
  const counts: Record<string, number> = {
    COMPLETED: 0,
    NEEDS_REVIEW: 0,
    ACTIVE: 0,
    FAILED: 0,
    NOT_STARTED: 0,
  };
  for (const s of submissions) {
    const latest = runs.find((r) => r.submissionId === s.id);
    const group = latest ? runs.filter((r) => r.groupId === latest.groupId) : [];
    const st = !group.length
      ? "NOT_STARTED"
      : group.some((r) => !["COMPLETED", "NEEDS_REVIEW", "FAILED", "CANCELLED"].includes(r.status))
        ? "ACTIVE"
        : group.some((r) => r.status === "NEEDS_REVIEW")
          ? "NEEDS_REVIEW"
          : group.every((r) => r.status === "FAILED" || r.status === "CANCELLED")
            ? "FAILED"
            : "COMPLETED";
    counts[st] = (counts[st] ?? 0) + 1;
  }
  const total = submissions.length || 1;
  const cost = runs.reduce((n, r) => n + Number(r.costUsd), 0);
  const snaps = submissions.length
    ? await db.repoSnapshot.findMany({
        where: { OR: submissions.map((s) => ({ sourceKey: sourceKeyFor(s), commitSha: s.commitSha })) },
        select: { facts: true },
      })
    : [];
  const est = await estimate({
    depth: settings.depth,
    consensus: settings.consensus,
    locs: submissions.map(
      (_, i) => (snaps[i]?.facts as { size?: { totalLoc?: number } } | null)?.size?.totalLoc ?? 0,
    ),
  });
  const percents = reports
    .filter((r) => r.percent != null && r.status !== "disqualified")
    .map((r) => r.percent!);
  const review = reports.filter((r) => r.status === "needs_review");

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <AutoRefresh active={counts.ACTIVE! > 0} />
      <section
        className="border-border bg-card rounded-xl border p-5 lg:col-span-2"
        aria-labelledby="progress-h"
      >
        <h2 id="progress-h" className="text-sm font-semibold">
          Progress
        </h2>
        <div
          className="bg-muted mt-3 flex h-3 overflow-hidden rounded-full"
          role="img"
          aria-label={BAR.map((b) => `${counts[b.key]} ${b.label}`).join(", ")}
        >
          {BAR.map((b) => (
            <div
              key={b.key}
              className={`${b.cls} transition-[width] duration-200`}
              style={{ width: `${(counts[b.key]! / total) * 100}%` }}
            />
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {BAR.map((b) => (
            <li key={b.key} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-sm ${b.cls}`} aria-hidden />
              {b.label}: <b>{counts[b.key]}</b>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-border bg-card rounded-xl border p-5" aria-labelledby="cost-h">
        <h2 id="cost-h" className="text-sm font-semibold">
          Cost
        </h2>
        <p className="mt-2 text-2xl font-semibold">${cost.toFixed(2)}</p>
        <p className="text-muted-foreground text-sm">spent so far</p>
        <p className="text-muted-foreground mt-2 text-xs">
          Estimate for a full {settings.depth} run: {est.label}
        </p>
      </section>

      <section className="border-border bg-card rounded-xl border p-5 lg:col-span-2" aria-labelledby="dist-h">
        <h2 id="dist-h" className="text-sm font-semibold">
          Score distribution
        </h2>
        {percents.length ? (
          <ScoreHistogram percents={percents} />
        ) : (
          <p className="text-muted-foreground mt-3 text-sm">No scores yet.</p>
        )}
      </section>

      <section
        className="border-border bg-card flex flex-col gap-3 rounded-xl border p-5"
        aria-labelledby="flags-h"
      >
        <h2 id="flags-h" className="flex items-center gap-1.5 text-sm font-semibold">
          <Flag className="text-warning size-4" aria-hidden /> Integrity flags
        </h2>
        {flags.length === 0 ? (
          <p className="text-muted-foreground text-sm">None raised.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {flags
              .sort((a, b) => b._count._all - a._count._all)
              .map((f) => (
                <li key={`${f.category}-${f.severity}`} className="flex justify-between gap-2">
                  <span>
                    {f.category.replace(/_/g, " ")}{" "}
                    <span className="text-muted-foreground">({f.severity})</span>
                  </span>
                  <b>{f._count._all}</b>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section
        className="border-border bg-card rounded-xl border p-5 lg:col-span-3"
        aria-labelledby="review-h"
      >
        <h2 id="review-h" className="flex items-center gap-1.5 text-sm font-semibold">
          <AlertTriangle className="text-warning size-4" aria-hidden /> Needs review ({review.length})
        </h2>
        {review.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">Nothing waiting for a human.</p>
        ) : (
          <ul className="divide-border mt-2 divide-y">
            {review.map((r) => {
              const w = r.warnings as { review?: string[] };
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link href={`/app/reports/${r.id}`} className="font-medium hover:underline">
                      {r.submission.displayName}
                    </Link>
                    <p className="text-muted-foreground truncate text-xs">
                      {w.review?.[0] ?? "Human-scored criteria pending"}
                    </p>
                  </div>
                  <Link
                    href={`/app/reports/${r.id}`}
                    className={buttonVariants({ size: "sm", variant: "secondary" })}
                  >
                    Review
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

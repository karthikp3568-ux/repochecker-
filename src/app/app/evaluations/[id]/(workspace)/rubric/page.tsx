import type { Metadata } from "next";
import Link from "next/link";
import { RankDiff } from "@/components/leaderboard/rank-diff";
import { RegradeAll } from "@/components/leaderboard/regrade-all";
import { AnchorsTable } from "@/components/rubric/anchors-table";
import { ASSESS_LABEL, TYPE_LABEL } from "@/components/rubric/criterion-card";
import { RubricDiff } from "@/components/rubric/rubric-diff";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { loadEvaluationPage } from "@/lib/access";
import { db } from "@/lib/db";
import { diffRubrics } from "@/lib/rubric/diff";
import { RubricSchema } from "@/lib/rubric/schema";

export const metadata: Metadata = { title: "Rubric" };

export default async function RubricPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { evaluation, canEdit } = await loadEvaluationPage(id);
  const versions = await db.rubricVersion.findMany({
    where: { evaluationId: id },
    orderBy: { version: "desc" },
    include: { lockedBy: { select: { name: true, email: true } } },
  });
  const active = versions.find((v) => v.id === evaluation.activeRubricVersionId);
  if (!active) {
    return (
      <div className="border-border flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
        <p className="font-medium">No locked rubric yet</p>
        {canEdit && (
          <Link
            href={`/app/evaluations/${id}/setup/intent`}
            className={buttonVariants({ className: "mt-4" })}
          >
            Build the rubric
          </Link>
        )}
      </div>
    );
  }
  const rubric = RubricSchema.parse(active.rubric);
  const submissions = await db.submission.count({ where: { evaluationId: id } });
  const gradedOnActive = await db.report.count({
    where: { rubricVersionId: active.id, submission: { evaluationId: id } },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Active rubric: v{active.version}</h2>
          <p className="text-muted-foreground text-sm">
            Locked {active.lockedAt.toLocaleString()} by {active.lockedBy.name ?? active.lockedBy.email} ·
            scale {rubric.scale.min}–{rubric.scale.max}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/app/evaluations/${id}/setup/rubric`}
              className={buttonVariants({ variant: "secondary" })}
            >
              Edit → creates v{(versions[0]?.version ?? 0) + 1}
            </Link>
            {gradedOnActive < submissions && (
              <RegradeAll evaluationId={id} version={active.version} pending={submissions - gradedOnActive} />
            )}
          </div>
        )}
      </div>

      <p className="text-sm">{rubric.summary}</p>

      <ol className="flex flex-col gap-3">
        {rubric.criteria.map((c) => (
          <li key={c.id}>
            <details className="border-border bg-card rounded-xl border">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-4 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1 font-medium">{c.name}</span>
                <Badge tone="accent">{TYPE_LABEL[c.type]}</Badge>
                <Badge>{c.scorer === "human" ? "Human" : "AI"}</Badge>
                <Badge>{ASSESS_LABEL[c.assessability]}</Badge>
                {c.type === "scored" && <span className="font-mono text-sm">{c.weight}</span>}
              </summary>
              <div className="border-border flex flex-col gap-3 border-t p-4 text-sm">
                <p>{c.description}</p>
                {c.boundary && <p className="text-muted-foreground">Not covered: {c.boundary}</p>}
                <ul className="list-disc pl-5">
                  {c.lookFor.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <AnchorsTable anchors={c.anchors} idPrefix={`ro-${c.id}`} />
                <p className="text-muted-foreground text-xs">Weight reasoning: {c.weightReasoning}</p>
              </div>
            </details>
          </li>
        ))}
      </ol>

      <section aria-labelledby="history-h" className="flex flex-col gap-3">
        <h2 id="history-h" className="text-lg font-semibold">
          Version history
        </h2>
        <ol className="flex flex-col gap-3">
          {versions.map((v, i) => {
            const prev = versions[i + 1];
            const diff = prev
              ? diffRubrics(RubricSchema.parse(prev.rubric), RubricSchema.parse(v.rubric))
              : null;
            return (
              <li key={v.id} className="border-border bg-card rounded-xl border p-4">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <b>v{v.version}</b>
                  {v.id === active.id && <Badge tone="success">Active</Badge>}
                  <span className="text-muted-foreground">
                    {v.lockedAt.toLocaleString()} · {v.lockedBy.name ?? v.lockedBy.email}
                  </span>
                </p>
                {diff ? (
                  <details className="mt-2">
                    <summary className="text-accent cursor-pointer text-sm">
                      Changes from v{prev!.version}
                    </summary>
                    <div className="mt-2">
                      <RubricDiff diff={diff} />
                    </div>
                  </details>
                ) : (
                  <p className="text-muted-foreground mt-1 text-xs">First version.</p>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {versions.length > 1 && (
        <RankDiff evaluationId={id} versions={versions.map((v) => ({ id: v.id, version: v.version }))} />
      )}
    </div>
  );
}

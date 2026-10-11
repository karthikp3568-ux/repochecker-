import type { Metadata } from "next";
import { Suspense } from "react";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { Skeleton } from "@/components/ui/alert";
import { loadEvaluationPage } from "@/lib/access";
import { db } from "@/lib/db";
import { RubricSchema } from "@/lib/rubric/schema";

export const metadata: Metadata = { title: "Leaderboard" };

export default async function LeaderboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { evaluation } = await loadEvaluationPage(id);
  const versions = await db.rubricVersion.findMany({
    where: { evaluationId: id },
    orderBy: { version: "desc" },
  });
  if (!evaluation.activeRubricVersionId || versions.length === 0) {
    return (
      <p className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
        Lock a rubric and grade submissions to see the leaderboard.
      </p>
    );
  }
  const criteria = Object.fromEntries(
    versions.map((v) => [
      v.id,
      RubricSchema.parse(v.rubric).criteria.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        weight: c.weight,
      })),
    ]),
  );
  const active = RubricSchema.parse(versions.find((v) => v.id === evaluation.activeRubricVersionId)!.rubric);
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <LeaderboardTable
        evaluationId={id}
        versions={versions.map((v) => ({ id: v.id, version: v.version }))}
        activeVersionId={evaluation.activeRubricVersionId}
        criteria={criteria}
        scaleMax={active.scale.max}
      />
    </Suspense>
  );
}

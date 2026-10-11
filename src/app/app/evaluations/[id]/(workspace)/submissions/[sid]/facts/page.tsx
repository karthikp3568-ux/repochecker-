import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FactsPanel } from "@/components/facts-panel";
import { loadEvaluationPage } from "@/lib/access";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Repository facts" };

export default async function FactsPage({ params }: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await params;
  const { evaluation, canEdit } = await loadEvaluationPage(id);
  const submission = await db.submission.findFirst({ where: { id: sid, evaluationId: evaluation.id } });
  if (!submission) notFound();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/app/evaluations/${id}`} className="text-muted-foreground text-sm hover:underline">
          ← {evaluation.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          {submission.displayName} — repository facts
        </h1>
        <p className="text-muted-foreground font-mono text-xs">
          {submission.repoUrl ?? "ZIP upload"} @ {submission.commitSha}
        </p>
      </div>
      <FactsPanel submissionId={submission.id} canIndex={canEdit} />
    </div>
  );
}

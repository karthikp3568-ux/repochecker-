import type { Metadata } from "next";
import { SubmissionsTable } from "@/components/workspace/submissions-table";
import { loadEvaluationPage } from "@/lib/access";
import { db } from "@/lib/db";
import { readSettings } from "@/lib/evaluation";
import { RubricSchema } from "@/lib/rubric/schema";

export const metadata: Metadata = { title: "Submissions" };

export default async function SubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { evaluation, canEdit } = await loadEvaluationPage(id);
  const version = evaluation.activeRubricVersionId
    ? await db.rubricVersion.findUnique({ where: { id: evaluation.activeRubricVersionId } })
    : null;
  const rubric = version ? RubricSchema.parse(version.rubric) : null;
  return (
    <SubmissionsTable
      evaluationId={id}
      criteria={(rubric?.criteria ?? [])
        .filter((c) => c.scorer === "ai")
        .map((c) => ({ id: c.id, name: c.name }))}
      scaleMax={rubric?.scale.max ?? 10}
      canEdit={canEdit}
      depth={readSettings(evaluation.settings).depth}
    />
  );
}

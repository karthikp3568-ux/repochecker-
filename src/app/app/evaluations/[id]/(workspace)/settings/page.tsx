import type { Metadata } from "next";
import { EvaluationSettings } from "@/components/workspace/evaluation-settings";
import { loadEvaluationPage } from "@/lib/access";
import { readSettings } from "@/lib/evaluation";

export const metadata: Metadata = { title: "Evaluation settings" };

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { evaluation, role, canEdit } = await loadEvaluationPage(id);
  const s = readSettings(evaluation.settings);
  return (
    <EvaluationSettings
      evaluationId={id}
      isOwner={role === "owner"}
      canEdit={canEdit}
      status={evaluation.status}
      deadline={evaluation.deadline?.toISOString() ?? null}
      initial={{
        depth: s.depth,
        treatInsufficientAsZero: s.treatInsufficientAsZero,
        deadlineMode: s.deadlineMode,
      }}
    />
  );
}

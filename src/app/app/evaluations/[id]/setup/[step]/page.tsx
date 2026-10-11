import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RubricEditor } from "@/components/rubric/rubric-editor";
import { ClarifyStep } from "@/components/wizard/clarify-step";
import { ContextForm } from "@/components/wizard/context-form";
import { IntentStep } from "@/components/wizard/intent-step";
import { RunSettingsStep } from "@/components/wizard/run-settings-step";
import { Stepper, WIZARD_STEPS, type WizardStep } from "@/components/wizard/stepper";
import { SubmissionsStep } from "@/components/wizard/submissions-step";
import { loadEvaluationPage } from "@/lib/access";
import { db } from "@/lib/db";
import { readSettings } from "@/lib/evaluation";
import { executionAllowed } from "@/lib/sandbox";
import { ContextSchema, RubricSchema, type Purpose } from "@/lib/rubric/schema";
import { draftRounds, draftRubric, getOrCreateDraft, type DraftAttachments } from "@/lib/rubric/service";

export const metadata: Metadata = { title: "Set up evaluation" };

export default async function SetupPage({ params }: { params: Promise<{ id: string; step: string }> }) {
  const { id, step: rawStep } = await params;
  if (!WIZARD_STEPS.some((s) => s.key === rawStep)) notFound();
  const step = rawStep as WizardStep;
  const { evaluation } = await loadEvaluationPage(id, "judge");

  const [draft, active, submissionCount] = await Promise.all([
    getOrCreateDraft(evaluation.id),
    evaluation.activeRubricVersionId
      ? db.rubricVersion.findUnique({ where: { id: evaluation.activeRubricVersionId } })
      : null,
    db.submission.count({ where: { evaluationId: evaluation.id } }),
  ]);
  const rounds = draftRounds(draft);
  const pending = rounds.at(-1) && !rounds.at(-1)!.answers && !rounds.at(-1)!.skipped ? rounds.at(-1)! : null;
  const rubric = draftRubric(draft);
  const activeRubric = active ? RubricSchema.parse(active.rubric) : null;
  const settings = readSettings(evaluation.settings);
  const context = ContextSchema.parse(evaluation.context ?? {});

  const reachable: Partial<Record<WizardStep, boolean>> = {
    context: true,
    intent: true,
    clarify: !!pending,
    rubric: !!rubric,
    submissions: !!active,
    run: !!active && submissionCount > 0,
  };
  const done: Partial<Record<WizardStep, boolean>> = {
    context: true,
    intent: !!draft.intent,
    clarify: rounds.length > 0 && !pending,
    rubric: !!active,
    submissions: submissionCount > 0,
    run: evaluation.status === "running" || evaluation.status === "completed",
  };
  if (!reachable[step])
    redirect(`/app/evaluations/${id}/setup/${pending ? "clarify" : rubric ? "rubric" : "intent"}`);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{evaluation.name}</h1>
          <Link href={`/app/evaluations/${id}`} className="text-muted-foreground text-sm hover:underline">
            Go to workspace →
          </Link>
        </div>
        <Stepper evaluationId={id} current={step} reachable={reachable} done={done} />
      </div>

      <div className={step === "rubric" ? "" : "max-w-3xl"}>
        {step === "context" && (
          <ContextForm
            evaluationId={id}
            initial={{ name: evaluation.name, purpose: evaluation.purpose as Purpose, context }}
          />
        )}
        {step === "intent" && (
          <IntentStep
            evaluationId={id}
            purpose={evaluation.purpose as Purpose}
            initialIntent={draft.intent}
            initialExistingRubric={(draft.attachments as DraftAttachments)?.existingRubric ?? null}
            hasRubric={!!rubric}
          />
        )}
        {step === "clarify" && pending && (
          <ClarifyStep
            key={rounds.length}
            evaluationId={id}
            questions={pending.questions}
            round={rounds.length}
          />
        )}
        {step === "rubric" && rubric && (
          <RubricEditor
            evaluationId={id}
            initial={rubric}
            executionEnabled={settings.execution}
            lockedVersion={active?.version ?? null}
            activeRubric={activeRubric}
          />
        )}
        {step === "submissions" && (
          <SubmissionsStep evaluationId={id} deadline={evaluation.deadline?.toISOString() ?? null} />
        )}
        {step === "run" && (
          <RunSettingsStep
            evaluationId={id}
            submissionCount={submissionCount}
            executionAllowed={executionAllowed()}
            initial={{ depth: settings.depth, consensus: settings.consensus, execution: settings.execution }}
          />
        )}
      </div>
    </div>
  );
}

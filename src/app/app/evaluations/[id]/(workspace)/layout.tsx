import Link from "next/link";
import { WorkspaceTabs } from "@/components/workspace/tabs";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { loadEvaluationPage } from "@/lib/access";
import { PURPOSE_LABELS } from "@/lib/rubric/render";
import type { Purpose } from "@/lib/rubric/schema";

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "accent" }> =
  {
    draft: { label: "Draft", tone: "neutral" },
    rubric_ready: { label: "Rubric ready", tone: "accent" },
    running: { label: "Grading", tone: "info" },
    completed: { label: "Completed", tone: "success" },
    archived: { label: "Archived", tone: "neutral" },
  };

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { evaluation, canEdit } = await loadEvaluationPage(id);
  const s = STATUS[evaluation.status] ?? STATUS.draft!;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/app" className="text-muted-foreground text-sm hover:underline">
            ← Evaluations
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">{evaluation.name}</h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone="accent">{PURPOSE_LABELS[evaluation.purpose as Purpose] ?? evaluation.purpose}</Badge>
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
        </div>
        {canEdit && (
          <Link
            href={`/app/evaluations/${id}/setup/${evaluation.activeRubricVersionId ? "submissions" : "intent"}`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {evaluation.activeRubricVersionId ? "Add submissions / run" : "Continue setup"}
          </Link>
        )}
      </div>
      <WorkspaceTabs evaluationId={id} />
      <div>{children}</div>
    </div>
  );
}

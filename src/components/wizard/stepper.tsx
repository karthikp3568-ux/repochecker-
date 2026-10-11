import { Check } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const WIZARD_STEPS = [
  { key: "context", label: "Context" },
  { key: "intent", label: "What matters" },
  { key: "clarify", label: "Clarify" },
  { key: "rubric", label: "Review rubric" },
  { key: "submissions", label: "Submissions" },
  { key: "run", label: "Run" },
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number]["key"];

/** Step navigation. `reachable` decides which steps are links; data is autosaved so moving never loses it. */
export function Stepper({
  evaluationId,
  current,
  reachable,
  done,
}: {
  evaluationId?: string;
  current: WizardStep;
  reachable: Partial<Record<WizardStep, boolean>>;
  done: Partial<Record<WizardStep, boolean>>;
}) {
  return (
    <nav aria-label="Setup progress" className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ol className="flex min-w-max items-center gap-1 sm:gap-2">
        {WIZARD_STEPS.map((step, i) => {
          const isCurrent = step.key === current;
          const canGo = !!evaluationId && reachable[step.key] && !isCurrent;
          const content = (
            <>
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium",
                  isCurrent && "border-accent bg-accent text-accent-foreground",
                  !isCurrent && done[step.key] && "border-success bg-success/10 text-success",
                  !isCurrent && !done[step.key] && "border-border text-muted-foreground",
                )}
              >
                {done[step.key] && !isCurrent ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn("text-sm", isCurrent ? "font-medium" : "text-muted-foreground")}>
                {step.label}
              </span>
              {done[step.key] && <span className="sr-only">(complete)</span>}
            </>
          );
          return (
            <li key={step.key} className="flex items-center gap-1 sm:gap-2">
              {i > 0 && <span aria-hidden className="bg-border h-px w-4 sm:w-8" />}
              {canGo ? (
                <Link
                  href={`/app/evaluations/${evaluationId}/setup/${step.key}`}
                  className="hover:bg-muted flex items-center gap-2 rounded-lg px-2 py-1"
                >
                  {content}
                </Link>
              ) : (
                <span
                  className="flex items-center gap-2 rounded-lg px-2 py-1"
                  aria-disabled={!isCurrent && !reachable[step.key] ? true : undefined}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

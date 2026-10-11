import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Ban, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const STAGE_ORDER = [
  "QUEUED",
  "FETCHING",
  "INDEXING",
  "EXECUTING",
  "GRADING",
  "VERIFYING",
  "SCORING",
] as const;
export const ACTIVE = new Set<string>(STAGE_ORDER);

const LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  QUEUED: "Queued",
  FETCHING: "Fetching",
  INDEXING: "Indexing",
  EXECUTING: "Executing",
  GRADING: "Grading",
  VERIFYING: "Verifying",
  SCORING: "Scoring",
  COMPLETED: "Completed",
  NEEDS_REVIEW: "Needs review",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const active = ACTIVE.has(status);
  const Icon =
    status === "COMPLETED"
      ? CheckCircle2
      : status === "NEEDS_REVIEW"
        ? AlertTriangle
        : status === "FAILED"
          ? XCircle
          : status === "CANCELLED"
            ? Ban
            : active
              ? Loader2
              : CircleDashed;
  const tone =
    status === "COMPLETED"
      ? "bg-success/10 text-success"
      : status === "NEEDS_REVIEW"
        ? "bg-warning/10 text-warning"
        : status === "FAILED"
          ? "bg-danger/10 text-danger"
          : active
            ? "bg-info/10 text-info"
            : "bg-muted text-muted-foreground";
  const stageIdx = STAGE_ORDER.indexOf(status as (typeof STAGE_ORDER)[number]);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon
        className={cn("size-3.5", active && status !== "QUEUED" && "motion-safe:animate-spin")}
        aria-hidden
      />
      {LABEL[status] ?? status}
      {active && stageIdx > 0 && (
        <span className="opacity-70" aria-label={`stage ${stageIdx} of ${STAGE_ORDER.length - 1}`}>
          {stageIdx}/{STAGE_ORDER.length - 1}
        </span>
      )}
    </span>
  );
}

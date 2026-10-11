/** Run failure codes (spec §14). */
export type FailureCode =
  | "CLONE_FAILED"
  | "REPO_TOO_LARGE"
  | "EMPTY_REPO"
  | "BAD_ARCHIVE"
  | "LLM_RATE_LIMITED"
  | "LLM_ERROR"
  | "LLM_REFUSAL"
  | "BUDGET_EXHAUSTED"
  | "TIMEOUT"
  | "SANDBOX_FAILED"
  | "CANCELLED"
  | "INTERNAL";

export const FAILURE_HELP: Record<FailureCode, string> = {
  CLONE_FAILED:
    "Check the URL is correct and public, or connect GitHub for private repositories, then retry.",
  REPO_TOO_LARGE:
    "The repository exceeds the size limits. Submit a smaller repo or ZIP without build output.",
  EMPTY_REPO: "No source files were found after excluding vendored, generated and binary files.",
  BAD_ARCHIVE: "The ZIP is corrupt or contains unsafe paths. Re-create it and upload again.",
  LLM_RATE_LIMITED: "The AI service was rate limited. The run will retry automatically.",
  LLM_ERROR: "The AI service failed. Retry the run.",
  LLM_REFUSAL: "The AI declined part of this review. Partial results were kept for a human to review.",
  BUDGET_EXHAUSTED:
    "The tool budget ran out before every criterion was scored. Review or re-run at a deeper depth.",
  TIMEOUT: "The run took longer than 30 minutes.",
  SANDBOX_FAILED: "Execution sandbox failed; grading continued in static mode.",
  CANCELLED: "The run was cancelled.",
  INTERNAL: "Unexpected error. Retry the run.",
};

export class PipelineError extends Error {
  constructor(
    public readonly code: FailureCode,
    message: string,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

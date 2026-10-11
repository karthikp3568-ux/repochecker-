/** Run depth presets (spec §7). The single source for effort + tool budgets. */
export const DEPTH_PRESETS = {
  quick: { label: "Quick", effort: "medium", toolBudget: 30, description: "Large hackathons, first pass" },
  standard: { label: "Standard", effort: "high", toolBudget: 70, description: "Most grading" },
  deep: { label: "Deep", effort: "xhigh", toolBudget: 160, description: "Finals, hiring, audits" },
} as const;

export type Depth = keyof typeof DEPTH_PRESETS;
export const DEFAULT_DEPTH: Depth = "standard";

/** Effort for the non-grading LLM calls (builder, refiner, expander, verifier). */
export const AUX_EFFORT = "medium" as const;

export const RUN_QUEUE = "runs";
export const RUN_EVENTS_CHANNEL = (runId: string) => `run-events:${runId}`;

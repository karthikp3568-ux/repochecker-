import { customAlphabet } from "nanoid";
import { z } from "zod";

/*
 * Rubric types (spec §4.3). LLM-facing schemas use `.nullable()` instead of optional
 * fields and arrays instead of records, so they translate cleanly to structured outputs.
 */

export const PURPOSES = ["hackathon", "course", "hiring", "audit", "self_review", "other"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const CRITERION_TYPES = ["scored", "gate", "bonus"] as const;
export const SCORERS = ["ai", "human"] as const;
export const ASSESSABILITY = ["static", "execution", "partial", "not_from_code"] as const;
export const GATE_ON_FAIL = ["disqualify", "cap", "flag"] as const;
export const WARNING_TYPES = [
  "unassessable",
  "needs_execution",
  "overlap",
  "weight_mismatch",
  "other",
] as const;

export const AnchorSchema = z.object({
  band: z.string().describe("Score range for this band on the rubric scale, e.g. '0-2'"),
  description: z.string(),
});

export const GateConfigSchema = z.object({
  onFail: z.enum(GATE_ON_FAIL),
  capAt: z.number().nullable().describe("Only for onFail=cap: the max overall score on the rubric scale"),
});

export const CriterionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  lookFor: z.array(z.string()),
  boundary: z.string().nullable(),
  anchors: z.array(AnchorSchema),
  weight: z.number().int(),
  weightReasoning: z.string(),
  type: z.enum(CRITERION_TYPES),
  gateConfig: GateConfigSchema.nullable(),
  bonusMax: z.number().nullable(),
  scorer: z.enum(SCORERS),
  assessability: z.enum(ASSESSABILITY),
  assessabilityNote: z.string().nullable(),
  suggested: z.boolean(),
  suggestionReason: z.string().nullable(),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const ScaleSchema = z.object({ min: z.number(), max: z.number() });
export type Scale = z.infer<typeof ScaleSchema>;

export const GradeBandSchema = z.object({ letter: z.string(), minPercent: z.number() });
export type GradeBand = z.infer<typeof GradeBandSchema>;

export const RubricWarningSchema = z.object({
  type: z.enum(WARNING_TYPES),
  criterionIds: z.array(z.string()),
  message: z.string(),
});
export type RubricWarning = z.infer<typeof RubricWarningSchema>;

export const RubricSchema = z.object({
  scale: ScaleSchema,
  gradeBands: z.array(GradeBandSchema),
  criteria: z.array(CriterionSchema),
  warnings: z.array(RubricWarningSchema),
  summary: z.string(),
});
export type Rubric = z.infer<typeof RubricSchema>;

export const SCALE_PRESETS: Scale[] = [
  { min: 0, max: 10 },
  { min: 1, max: 5 },
  { min: 0, max: 100 },
];
export const DEFAULT_SCALE: Scale = { min: 0, max: 10 };
export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { letter: "A", minPercent: 85 },
  { letter: "B", minPercent: 70 },
  { letter: "C", minPercent: 55 },
  { letter: "D", minPercent: 40 },
  { letter: "F", minPercent: 0 },
];

// ───────────── Evaluation context (not a criterion; informs grading) ─────────────

export const ContextSchema = z.object({
  brief: z.string().max(50_000).default(""),
  briefFileName: z.string().nullable().default(null),
  deadline: z.string().nullable().default(null),
  timeLimit: z.string().max(200).nullable().default(null),
  teamSize: z.string().max(200).nullable().default(null),
  experienceLevel: z.string().max(200).nullable().default(null),
  expectedStack: z.string().max(500).nullable().default(null),
});
export type EvaluationContext = z.infer<typeof ContextSchema>;

// ───────────── LLM output schemas ─────────────

/** Criterion as produced by the model: id may be missing (assigned in code). */
export const LlmCriterionSchema = CriterionSchema.extend({
  id: z.string().nullable().describe("Keep existing ids unchanged; null for new criteria"),
});

export const LlmRubricSchema = RubricSchema.extend({ criteria: z.array(LlmCriterionSchema) });

export const QuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.string()).describe("2-4 concrete quick-pick options"),
  allowFreeText: z.boolean(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const BuilderOutputSchema = z.object({
  mode: z.enum(["questions", "rubric"]),
  questions: z.array(QuestionSchema).nullable().describe("1-4 questions when mode=questions, else null"),
  rubric: LlmRubricSchema.nullable().describe("The full rubric when mode=rubric, else null"),
});
export type BuilderOutput = z.infer<typeof BuilderOutputSchema>;

export const CHANGE_TYPES = ["added", "removed", "modified", "reweighted"] as const;
export const RubricChangeSchema = z.object({
  criterionId: z.string(),
  changeType: z.enum(CHANGE_TYPES),
  summary: z.string(),
});
export type RubricChange = z.infer<typeof RubricChangeSchema>;

export const RefinerOutputSchema = z.object({
  mode: z.enum(["rubric", "questions"]),
  question: QuestionSchema.nullable().describe("One clarifying question when mode=questions"),
  rubric: LlmRubricSchema.nullable(),
  changes: z.array(RubricChangeSchema),
});
export type RefinerOutput = z.infer<typeof RefinerOutputSchema>;

export const ExpanderOutputSchema = z.object({
  criterion: LlmCriterionSchema,
  rebalancedWeights: z
    .array(z.object({ criterionId: z.string(), weight: z.number().int() }))
    .describe("New weight for every scored criterion, including the new one (use id 'new' for it)"),
});
export type ExpanderOutput = z.infer<typeof ExpanderOutputSchema>;

// ───────────── Clarification rounds ─────────────

export const AnswerSchema = z.object({
  questionId: z.string(),
  choice: z.string().nullable(),
  freeText: z.string().max(2000).nullable(),
});
export type Answer = z.infer<typeof AnswerSchema>;

export type ClarificationRound = { questions: Question[]; answers: Answer[] | null; skipped?: boolean };

// ───────────── Helpers ─────────────

const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);
export const newCriterionId = () => `crit_${nano()}`;

export function emptyRubric(): Rubric {
  return {
    scale: DEFAULT_SCALE,
    gradeBands: DEFAULT_GRADE_BANDS,
    criteria: [],
    warnings: [],
    summary: "",
  };
}

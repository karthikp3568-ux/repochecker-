import type { Evaluation, RubricDraft } from "@/generated/prisma/client";
import { ApiError } from "../api";
import { AUX_EFFORT } from "../config";
import { db } from "../db";
import { readSettings } from "../evaluation";
import { llm } from "../llm/client";
import { BUILDER_SYSTEM, builderUserMessage } from "../llm/prompts/builder";
import { EXPANDER_SYSTEM, expanderUserMessage } from "../llm/prompts/expander";
import { REFINER_SYSTEM, refinerUserMessage } from "../llm/prompts/refiner";
import { normalizeCriterion, normalizeRubric } from "./normalize";
import { renderContext } from "./render";
import {
  BuilderOutputSchema,
  ContextSchema,
  DEFAULT_SCALE,
  ExpanderOutputSchema,
  RefinerOutputSchema,
  RubricSchema,
  emptyRubric,
  type Answer,
  type ClarificationRound,
  type Criterion,
  type Question,
  type Rubric,
  type RubricChange,
} from "./schema";
import { deepEqual } from "../utils";
import { validateRubric } from "./validate";

export const MAX_QUESTION_ROUNDS = 2;

export type DraftAttachments = { existingRubric?: string | null; existingRubricFileName?: string | null };

export async function getOrCreateDraft(evaluationId: string): Promise<RubricDraft> {
  return db.rubricDraft.upsert({
    where: { evaluationId },
    update: {},
    create: { evaluationId, intent: "", attachments: {}, rubric: emptyRubric() },
  });
}

export function draftRounds(draft: RubricDraft): ClarificationRound[] {
  return Array.isArray(draft.questions) ? (draft.questions as unknown as ClarificationRound[]) : [];
}

export function draftRubric(draft: RubricDraft): Rubric | null {
  const parsed = RubricSchema.safeParse(draft.rubric);
  return parsed.success && parsed.data.criteria.length > 0 ? parsed.data : null;
}

function contextText(evaluation: Evaluation) {
  return renderContext(evaluation.purpose, ContextSchema.parse(evaluation.context ?? {}));
}

function formatAnswers(rounds: ClarificationRound[]): string | null {
  const lines: string[] = [];
  for (const round of rounds) {
    if (round.skipped) {
      lines.push(
        `(The user skipped these questions: "${round.questions.map((q) => q.question).join('", "')}" — use your best judgment.)`,
      );
      continue;
    }
    for (const q of round.questions) {
      const a = round.answers?.find((x) => x.questionId === q.id);
      const parts = [a?.choice, a?.freeText].filter((s): s is string => !!s?.trim());
      lines.push(
        `Q: ${q.question}\nA: ${parts.length ? parts.join(" — ") : "(no answer; use your best judgment)"}`,
      );
    }
  }
  return lines.length ? lines.join("\n\n") : null;
}

/** Fill warning criterionIds by matching criterion names mentioned in the message. */
function linkWarnings(rubric: Rubric): Rubric {
  return {
    ...rubric,
    warnings: rubric.warnings.map((w) =>
      w.criterionIds.length
        ? w
        : {
            ...w,
            criterionIds: rubric.criteria
              .filter((c) => w.message.toLowerCase().includes(c.name.toLowerCase()))
              .map((c) => c.id),
          },
    ),
  };
}

export type BuilderResult = { mode: "questions"; questions: Question[] } | { mode: "rubric"; rubric: Rubric };

async function callBuilder(
  evaluation: Evaluation,
  draft: RubricDraft,
  rounds: ClarificationRound[],
  mustProduce: boolean,
) {
  const attachments = (draft.attachments ?? {}) as DraftAttachments;
  const current = draftRubric(draft);
  const { data } = await llm().structured({
    task: "rubric.build",
    system: BUILDER_SYSTEM,
    user: builderUserMessage({
      purpose: evaluation.purpose,
      context: contextText(evaluation),
      intent: draft.intent,
      existingRubric: attachments.existingRubric ?? null,
      priorAnswers: formatAnswers(rounds),
      scale: current?.scale ?? DEFAULT_SCALE,
      mustProduceRubric: mustProduce,
    }),
    schema: BuilderOutputSchema,
    effort: AUX_EFFORT,
    maxTokens: 20000,
  });
  return data;
}

/** Run the builder; ask questions (≤ 2 rounds) or store the drafted rubric. */
export async function runBuilder(
  evaluation: Evaluation,
  draft: RubricDraft,
  rounds: ClarificationRound[],
): Promise<BuilderResult> {
  const mustProduce = rounds.length >= MAX_QUESTION_ROUNDS || rounds.some((r) => r.skipped);
  let out = await callBuilder(evaluation, draft, rounds, mustProduce);

  if (out.mode === "questions" && !mustProduce && out.questions?.length) {
    const questions = out.questions.slice(0, 4).map((q, i) => ({
      ...q,
      id: q.id || `q${rounds.length + 1}_${i + 1}`,
      options: q.options.slice(0, 4),
    }));
    await db.rubricDraft.update({
      where: { id: draft.id },
      data: { questions: [...rounds, { questions, answers: null }] as object[] },
    });
    return { mode: "questions", questions };
  }
  if (out.mode !== "rubric" || !out.rubric) out = await callBuilder(evaluation, draft, rounds, true);
  if (!out.rubric)
    throw new ApiError(502, "LLM_ERROR", "The rubric builder did not return a rubric. Please retry.");

  const rubric = linkWarnings(normalizeRubric(out.rubric));
  await db.rubricDraft.update({ where: { id: draft.id }, data: { rubric, questions: rounds as object[] } });
  return { mode: "rubric", rubric };
}

export async function answerQuestions(
  evaluation: Evaluation,
  draft: RubricDraft,
  answers: Answer[],
  skip: boolean,
) {
  const rounds = draftRounds(draft);
  const last = rounds.at(-1);
  if (!last || last.answers || last.skipped)
    throw new ApiError(409, "NO_PENDING_QUESTIONS", "There are no open questions.");
  const updated: ClarificationRound[] = [
    ...rounds.slice(0, -1),
    skip ? { ...last, skipped: true } : { ...last, answers },
  ];
  await db.rubricDraft.update({
    where: { id: draft.id },
    data: { questions: updated as object[], answers: answers as object[] },
  });
  return runBuilder(evaluation, draft, updated);
}

export type RefineResult =
  { mode: "rubric"; rubric: Rubric; changes: RubricChange[] } | { mode: "questions"; question: Question };

export async function refineRubric(
  evaluation: Evaluation,
  rubric: Rubric,
  instruction: string,
): Promise<RefineResult> {
  const { data } = await llm().structured({
    task: "rubric.refine",
    system: REFINER_SYSTEM,
    user: refinerUserMessage({
      rubricJson: JSON.stringify(rubric, null, 2),
      context: contextText(evaluation),
      instruction,
    }),
    schema: RefinerOutputSchema,
    effort: AUX_EFFORT,
    maxTokens: 20000,
  });
  if (data.mode === "questions" && data.question) return { mode: "questions", question: data.question };
  if (!data.rubric)
    throw new ApiError(502, "LLM_ERROR", "The refiner did not return a rubric. Please rephrase.");
  // Scale and grade bands are user-controlled settings; the refiner can't silently change them.
  const refined = linkWarnings(
    normalizeRubric({ ...data.rubric, scale: rubric.scale, gradeBands: rubric.gradeBands }),
  );
  return { mode: "rubric", rubric: refined, changes: data.changes };
}

export async function expandCriterion(evaluation: Evaluation, rubric: Rubric, sentence: string) {
  const { data } = await llm().structured({
    task: "rubric.expand",
    system: EXPANDER_SYSTEM,
    user: expanderUserMessage({
      rubricJson: JSON.stringify(rubric, null, 2),
      context: contextText(evaluation),
      sentence,
    }),
    schema: ExpanderOutputSchema,
    effort: AUX_EFFORT,
    maxTokens: 12000,
  });
  const criterion: Criterion = normalizeCriterion(
    { ...data.criterion, id: null, suggested: false, suggestionReason: null },
    new Set(rubric.criteria.map((c) => c.id)),
  );
  const rebalancedWeights = data.rebalancedWeights
    .map((w) => ({
      criterionId: w.criterionId === "new" ? criterion.id : w.criterionId,
      weight: Math.max(0, Math.round(w.weight)),
    }))
    .filter((w) => w.criterionId === criterion.id || rubric.criteria.some((c) => c.id === w.criterionId));
  const own = rebalancedWeights.find((w) => w.criterionId === criterion.id);
  if (own && criterion.type === "scored") criterion.weight = own.weight;
  return { criterion, rebalancedWeights };
}

export async function lockRubric(evaluation: Evaluation, draft: RubricDraft, rubric: Rubric, userId: string) {
  const settings = readSettings(evaluation.settings);
  const result = validateRubric(rubric, { executionEnabled: settings.execution });
  if (!result.valid)
    throw new ApiError(422, "RUBRIC_INVALID", "The rubric has validation errors.", result.errors);

  if (evaluation.activeRubricVersionId) {
    const active = await db.rubricVersion.findUnique({ where: { id: evaluation.activeRubricVersionId } });
    // Locking an unchanged rubric reuses the active version instead of minting a duplicate.
    if (active && deepEqual(active.rubric, rubric)) return active;
  }

  return db.$transaction(async (tx) => {
    const last = await tx.rubricVersion.findFirst({
      where: { evaluationId: evaluation.id },
      orderBy: { version: "desc" },
    });
    const version = await tx.rubricVersion.create({
      data: {
        evaluationId: evaluation.id,
        version: (last?.version ?? 0) + 1,
        intent: draft.intent,
        clarifications: (draft.questions ?? []) as object[],
        rubric,
        lockedById: userId,
      },
    });
    await tx.rubricDraft.update({ where: { id: draft.id }, data: { rubric } });
    await tx.evaluation.update({
      where: { id: evaluation.id },
      data: {
        activeRubricVersionId: version.id,
        status: evaluation.status === "draft" ? "rubric_ready" : evaluation.status,
      },
    });
    return version;
  });
}

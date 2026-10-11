import type { z } from "zod";
import {
  DEFAULT_GRADE_BANDS,
  DEFAULT_SCALE,
  newCriterionId,
  type Criterion,
  type LlmRubricSchema,
  type Rubric,
} from "./schema";

type LlmRubric = z.infer<typeof LlmRubricSchema>;
type LlmCriterion = LlmRubric["criteria"][number];

/**
 * Turn model output into a well-formed Rubric: assign missing/duplicate ids, keep
 * known ids stable, zero gate/bonus weights, and drop configs that don't apply.
 * Does not hide real problems — validation (validate.ts) still reports them.
 */
export function normalizeCriterion(c: LlmCriterion, usedIds: Set<string>): Criterion {
  const id = c.id?.trim() && !usedIds.has(c.id.trim()) ? c.id.trim() : newCriterionId();
  usedIds.add(id);
  return {
    ...c,
    id,
    name: c.name.trim(),
    weight: c.type === "scored" ? Math.max(0, Math.round(c.weight)) : 0,
    gateConfig: c.type === "gate" ? (c.gateConfig ?? { onFail: "flag", capAt: null }) : null,
    bonusMax: c.type === "bonus" ? (c.bonusMax ?? 1) : null,
    lookFor: c.lookFor.map((s) => s.trim()).filter(Boolean),
  };
}

export function normalizeRubric(r: LlmRubric): Rubric {
  const used = new Set<string>();
  const scale = r.scale && r.scale.max > r.scale.min ? r.scale : DEFAULT_SCALE;
  const criteria = r.criteria.map((c) => normalizeCriterion(c, used));
  const validIds = new Set(criteria.map((c) => c.id));
  return {
    scale,
    gradeBands: r.gradeBands?.length
      ? [...r.gradeBands].sort((a, b) => b.minPercent - a.minPercent)
      : DEFAULT_GRADE_BANDS,
    criteria,
    warnings: r.warnings.map((w) => ({
      ...w,
      criterionIds: w.criterionIds.filter((id) => validIds.has(id)),
    })),
    summary: r.summary,
  };
}

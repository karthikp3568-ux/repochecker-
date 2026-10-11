import type { Rubric } from "./schema";

export type ValidationIssue = { criterionId?: string; field?: string; message: string };
export type ValidationResult = { valid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] };

/** Lock-time validation (spec §4.4). Enforced in code, never trusted to the LLM. */
export function validateRubric(rubric: Rubric, opts: { executionEnabled?: boolean } = {}): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const { criteria, scale } = rubric;

  if (!(scale.max > scale.min))
    errors.push({ field: "scale", message: "Scale max must be greater than min." });

  if (criteria.length < 1) errors.push({ message: "Add at least one criterion." });
  if (criteria.length > 15)
    errors.push({ message: `At most 15 criteria are allowed (you have ${criteria.length}).` });

  const scored = criteria.filter((c) => c.type === "scored");
  if (criteria.length > 0 && scored.length === 0)
    errors.push({ message: "At least one criterion must be scored." });

  const total = scored.reduce((n, c) => n + c.weight, 0);
  if (scored.length > 0 && total !== 100) {
    errors.push({ field: "weights", message: `Scored weights must sum to 100 (currently ${total}).` });
  }

  const names = new Map<string, number>();
  for (const c of criteria) {
    const label = c.name.trim() || "Untitled criterion";
    const key = c.name.trim().toLowerCase();
    names.set(key, (names.get(key) ?? 0) + 1);

    if (!c.name.trim())
      errors.push({ criterionId: c.id, field: "name", message: "A criterion is missing its name." });
    if (!c.description.trim()) {
      errors.push({ criterionId: c.id, field: "description", message: `"${label}" needs a description.` });
    }
    if (c.type === "scored") {
      if (!Number.isInteger(c.weight) || c.weight < 0) {
        errors.push({
          criterionId: c.id,
          field: "weight",
          message: `"${label}" weight must be a whole number ≥ 0.`,
        });
      }
      if (c.weight === 0) {
        warnings.push({
          criterionId: c.id,
          field: "weight",
          message: `"${label}" has weight 0 and won't affect the score.`,
        });
      }
    } else if (c.weight !== 0) {
      errors.push({
        criterionId: c.id,
        field: "weight",
        message: `"${label}" is a ${c.type}; its weight must be 0.`,
      });
    }
    if (c.anchors.length !== 5) {
      errors.push({
        criterionId: c.id,
        field: "anchors",
        message: `"${label}" needs exactly 5 scoring anchors (has ${c.anchors.length}).`,
      });
    } else if (c.anchors.some((a) => !a.description.trim() || !a.band.trim())) {
      errors.push({ criterionId: c.id, field: "anchors", message: `"${label}" has an empty anchor.` });
    }
    const lookFor = c.lookFor.filter((s) => s.trim());
    if (lookFor.length < 3) {
      errors.push({
        criterionId: c.id,
        field: "lookFor",
        message: `"${label}" needs at least 3 "look for" signals (has ${lookFor.length}).`,
      });
    }
    if (c.assessability === "not_from_code" && c.scorer !== "human") {
      errors.push({
        criterionId: c.id,
        field: "scorer",
        message: `"${label}" can't be judged from code, so it must be human-scored.`,
      });
    }
    if (c.type === "gate") {
      if (!c.gateConfig)
        errors.push({ criterionId: c.id, field: "gateConfig", message: `"${label}" needs a gate action.` });
      else if (
        c.gateConfig.onFail === "cap" &&
        (c.gateConfig.capAt == null || c.gateConfig.capAt < scale.min || c.gateConfig.capAt > scale.max)
      ) {
        errors.push({
          criterionId: c.id,
          field: "gateConfig",
          message: `"${label}" caps the score but the cap must be within ${scale.min}–${scale.max}.`,
        });
      }
    }
    if (c.type === "bonus" && (c.bonusMax == null || c.bonusMax <= 0 || c.bonusMax > scale.max - scale.min)) {
      errors.push({
        criterionId: c.id,
        field: "bonusMax",
        message: `"${label}" needs a positive bonus maximum within the scale.`,
      });
    }
    if (c.assessability === "execution" && !opts.executionEnabled) {
      warnings.push({
        criterionId: c.id,
        message: `"${label}" works best with execution mode, which is off. It will be judged by reading code only.`,
      });
    }
  }
  for (const [key, count] of names) {
    if (key && count > 1)
      errors.push({
        field: "name",
        message: `Criterion names must be unique ("${key}" appears ${count} times).`,
      });
  }

  const bandLetters = rubric.gradeBands.map((b) => b.letter.trim());
  if (bandLetters.some((l) => !l))
    errors.push({ field: "gradeBands", message: "Every grade band needs a letter." });
  if (!rubric.gradeBands.some((b) => b.minPercent <= 0)) {
    errors.push({ field: "gradeBands", message: "The lowest grade band must start at 0%." });
  }

  return { valid: errors.length === 0, errors, warnings };
}

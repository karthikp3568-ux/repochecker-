import type { Criterion, Rubric } from "./schema";

export type CriterionDiff =
  | { kind: "added"; after: Criterion }
  | { kind: "removed"; before: Criterion }
  | { kind: "changed"; before: Criterion; after: Criterion; fields: (keyof Criterion)[] }
  | { kind: "unchanged"; after: Criterion };

export type RubricDiff = {
  criteria: CriterionDiff[];
  scaleChanged: boolean;
  bandsChanged: boolean;
  hasChanges: boolean;
};

const FIELDS: (keyof Criterion)[] = [
  "name",
  "description",
  "lookFor",
  "boundary",
  "anchors",
  "weight",
  "weightReasoning",
  "type",
  "gateConfig",
  "bonusMax",
  "scorer",
  "assessability",
  "assessabilityNote",
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Field-level diff between two rubrics, matched by criterion id. Order follows `after`, removed last. */
export function diffRubrics(before: Rubric, after: Rubric): RubricDiff {
  const beforeById = new Map(before.criteria.map((c) => [c.id, c]));
  const afterIds = new Set(after.criteria.map((c) => c.id));
  const criteria: CriterionDiff[] = [];

  for (const c of after.criteria) {
    const prev = beforeById.get(c.id);
    if (!prev) {
      criteria.push({ kind: "added", after: c });
      continue;
    }
    const fields = FIELDS.filter((f) => !same(prev[f], c[f]));
    criteria.push(
      fields.length ? { kind: "changed", before: prev, after: c, fields } : { kind: "unchanged", after: c },
    );
  }
  for (const c of before.criteria) if (!afterIds.has(c.id)) criteria.push({ kind: "removed", before: c });

  const scaleChanged = !same(before.scale, after.scale);
  const bandsChanged = !same(before.gradeBands, after.gradeBands);
  return {
    criteria,
    scaleChanged,
    bandsChanged,
    hasChanges: scaleChanged || bandsChanged || criteria.some((d) => d.kind !== "unchanged"),
  };
}

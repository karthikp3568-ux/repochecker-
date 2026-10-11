import type { Criterion } from "./schema";

/**
 * Scale non-negative values to integers summing exactly to `total` (largest-remainder method).
 * All-zero input is split as evenly as possible.
 */
export function apportion(values: number[], total = 100): number[] {
  if (values.length === 0) return [];
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  const basis = sum > 0 ? clean : clean.map(() => 1);
  const basisSum = sum > 0 ? sum : basis.length;
  const exact = basis.map((v) => (v / basisSum) * total);
  const floors = exact.map(Math.floor);
  let remaining = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i]! += 1;
    remaining -= 1;
  }
  return floors;
}

/** Proportionally rescale scored-criterion weights to sum to 100; gate/bonus weights become 0. */
export function autoBalance(criteria: Criterion[]): Criterion[] {
  const scored = criteria.filter((c) => c.type === "scored");
  const balanced = apportion(scored.map((c) => c.weight));
  const byId = new Map(scored.map((c, i) => [c.id, balanced[i]!]));
  return criteria.map((c) => ({ ...c, weight: c.type === "scored" ? byId.get(c.id)! : 0 }));
}

export function scoredWeightTotal(criteria: Criterion[]): number {
  return criteria.filter((c) => c.type === "scored").reduce((n, c) => n + c.weight, 0);
}

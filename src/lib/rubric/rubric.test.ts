import { describe, expect, it } from "vitest";
import { diffRubrics } from "./diff";
import { normalizeRubric } from "./normalize";
import { emptyRubric, type Criterion, type Rubric } from "./schema";
import { validateRubric } from "./validate";
import { apportion, autoBalance } from "./weights";

const anchors = ["0-2", "3-4", "5-6", "7-8", "9-10"].map((band) => ({ band, description: `band ${band}` }));

function crit(over: Partial<Criterion> = {}): Criterion {
  return {
    id: over.id ?? `crit_${Math.random().toString(36).slice(2, 8)}`,
    name: "Works",
    description: "It runs.",
    lookFor: ["a", "b", "c"],
    boundary: null,
    anchors,
    weight: 100,
    weightReasoning: "only criterion",
    type: "scored",
    gateConfig: null,
    bonusMax: null,
    scorer: "ai",
    assessability: "static",
    assessabilityNote: null,
    suggested: false,
    suggestionReason: null,
    ...over,
  };
}

const rubric = (criteria: Criterion[]): Rubric => ({ ...emptyRubric(), criteria, summary: "s" });

describe("apportion", () => {
  it("sums exactly to the total", () => {
    for (const vals of [[1, 1, 1], [33, 33, 33], [5, 0, 7, 11], [0, 0], [1]]) {
      expect(apportion(vals).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });
  it("is proportional", () => {
    expect(apportion([50, 25, 25])).toEqual([50, 25, 25]);
    expect(apportion([2, 1, 1])).toEqual([50, 25, 25]);
  });
  it("splits zeros evenly", () => {
    expect(apportion([0, 0, 0])).toEqual([34, 33, 33]);
  });
});

describe("autoBalance", () => {
  it("rescales scored and zeroes gates/bonuses", () => {
    const out = autoBalance([
      crit({ id: "a", name: "A", weight: 30 }),
      crit({ id: "b", name: "B", weight: 30 }),
      crit({ id: "g", name: "G", type: "gate", weight: 5, gateConfig: { onFail: "flag", capAt: null } }),
    ]);
    expect(out.map((c) => c.weight)).toEqual([50, 50, 0]);
  });
});

describe("validateRubric", () => {
  it("accepts a minimal valid rubric", () => {
    expect(validateRubric(rubric([crit()])).valid).toBe(true);
  });

  it("requires weights summing to 100", () => {
    const r = validateRubric(rubric([crit({ name: "A", weight: 60 }), crit({ name: "B", weight: 30 })]));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "weights")).toBe(true);
  });

  it("requires at least one scored criterion and at most 15", () => {
    expect(validateRubric(rubric([])).valid).toBe(false);
    expect(
      validateRubric(rubric([crit({ type: "gate", weight: 0, gateConfig: { onFail: "flag", capAt: null } })]))
        .valid,
    ).toBe(false);
    const many = Array.from({ length: 16 }, (_, i) => crit({ name: `C${i}`, weight: i === 0 ? 100 : 0 }));
    expect(validateRubric(rubric(many)).errors.some((e) => /15/.test(e.message))).toBe(true);
  });

  it("requires exactly 5 anchors and 3+ lookFor", () => {
    const r = validateRubric(rubric([crit({ anchors: anchors.slice(0, 4), lookFor: ["x"] })]));
    expect(r.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["anchors", "lookFor"]));
  });

  it("forces human scorer for not_from_code", () => {
    const r = validateRubric(rubric([crit({ assessability: "not_from_code" })]));
    expect(r.errors.some((e) => e.field === "scorer")).toBe(true);
  });

  it("requires gate/bonus weight 0 and unique names", () => {
    const r = validateRubric(
      rubric([crit({ name: "Same" }), crit({ name: "same", type: "bonus", weight: 5, bonusMax: 1 })]),
    );
    expect(r.errors.some((e) => e.field === "weight")).toBe(true);
    expect(r.errors.some((e) => /unique/.test(e.message))).toBe(true);
  });

  it("warns (not blocks) when execution is needed but off", () => {
    const r = validateRubric(rubric([crit({ assessability: "execution" })]), { executionEnabled: false });
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBe(1);
  });

  it("validates cap gates against the scale", () => {
    const r = validateRubric(
      rubric([
        crit(),
        crit({ name: "G", type: "gate", weight: 0, gateConfig: { onFail: "cap", capAt: 42 } }),
      ]),
    );
    expect(r.errors.some((e) => e.field === "gateConfig")).toBe(true);
  });
});

describe("normalizeRubric", () => {
  it("assigns ids, dedupes, and zeroes non-scored weights", () => {
    const out = normalizeRubric({
      ...emptyRubric(),
      criteria: [
        { ...crit({ name: "A" }), id: null },
        { ...crit({ name: "B" }), id: "crit_dup" },
        { ...crit({ name: "C", type: "bonus", weight: 9 }), id: "crit_dup" },
      ],
    });
    const ids = out.criteria.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => id.startsWith("crit_"))).toBe(true);
    expect(out.criteria[2]!.weight).toBe(0);
    expect(out.criteria[2]!.bonusMax).toBe(1);
  });
});

describe("diffRubrics", () => {
  it("detects added, removed, and changed fields", () => {
    const a = rubric([crit({ id: "x", name: "X", weight: 50 }), crit({ id: "y", name: "Y", weight: 50 })]);
    const b = rubric([crit({ id: "x", name: "X", weight: 70 }), crit({ id: "z", name: "Z", weight: 30 })]);
    const d = diffRubrics(a, b);
    expect(d.criteria.map((c) => c.kind)).toEqual(["changed", "added", "removed"]);
    const changed = d.criteria[0];
    expect(changed?.kind === "changed" && changed.fields).toEqual(["weight"]);
    expect(d.hasChanges).toBe(true);
    expect(diffRubrics(a, a).hasChanges).toBe(false);
  });
});

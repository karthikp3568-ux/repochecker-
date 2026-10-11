import { describe, expect, it } from "vitest";
import { emptyRubric, type Criterion, type Rubric } from "./rubric/schema";
import { compareForRanking, computeScore, letterFor, median } from "./scoring";

const anchors = Array.from({ length: 5 }, (_, i) => ({ band: String(i), description: "d" }));
const c = (id: string, over: Partial<Criterion> = {}): Criterion => ({
  id,
  name: id,
  description: "d",
  lookFor: ["a", "b", "c"],
  boundary: null,
  anchors,
  weight: 50,
  weightReasoning: "",
  type: "scored",
  gateConfig: null,
  bonusMax: null,
  scorer: "ai",
  assessability: "static",
  assessabilityNote: null,
  suggested: false,
  suggestionReason: null,
  ...over,
});
const rubric = (criteria: Criterion[], scale = { min: 0, max: 10 }): Rubric => ({
  ...emptyRubric(),
  scale,
  criteria,
});

describe("computeScore", () => {
  it("computes a weighted average on the scale", () => {
    const r = rubric([c("a", { weight: 75 }), c("b", { weight: 25 })]);
    const s = computeScore(r, { a: { status: "scored", score: 8 }, b: { status: "scored", score: 4 } });
    expect(s.overall).toBe(7); // .75*.8 + .25*.4 = .7
    expect(s.percent).toBe(70);
    expect(s.letter).toBe("B");
  });

  it("normalizes non-zero-based scales", () => {
    const r = rubric([c("a", { weight: 100 })], { min: 1, max: 5 });
    const s = computeScore(r, { a: { status: "scored", score: 4 } });
    expect(s.percent).toBe(75);
    expect(s.overall).toBe(4);
  });

  it("excludes insufficient evidence and renormalizes, with a warning", () => {
    const r = rubric([c("a", { weight: 60 }), c("b", { weight: 40 })]);
    const s = computeScore(r, { a: { status: "scored", score: 6 }, b: { status: "insufficient_evidence" } });
    expect(s.overall).toBe(6);
    expect(s.warnings.join()).toMatch(/insufficient/);
  });

  it("can treat insufficient as zero", () => {
    const r = rubric([c("a", { weight: 50 }), c("b", { weight: 50 })]);
    const s = computeScore(
      r,
      { a: { status: "scored", score: 10 }, b: { status: "insufficient_evidence" } },
      { treatInsufficientAsZero: true },
    );
    expect(s.overall).toBe(5);
  });

  it("applies overrides and human scores; unscored human criteria are excluded", () => {
    const r = rubric([c("a", { weight: 50 }), c("h", { weight: 50, scorer: "human" })]);
    expect(computeScore(r, { a: { status: "scored", score: 4, override: 8 } }).overall).toBe(8);
    expect(computeScore(r, { a: { status: "scored", score: 4 }, h: { human: 10 } }).overall).toBe(7);
    const pending = computeScore(r, { a: { status: "scored", score: 4 } });
    expect(pending.overall).toBe(4);
    expect(pending.warnings.join()).toMatch(/human score/);
  });

  it("adds bonus points capped at the scale max", () => {
    const r = rubric([c("a", { weight: 100 }), c("x", { type: "bonus", weight: 0, bonusMax: 1 })]);
    expect(
      computeScore(r, { a: { status: "scored", score: 7 }, x: { status: "scored", score: 1 } }).overall,
    ).toBe(8);
    expect(
      computeScore(r, { a: { status: "scored", score: 9.5 }, x: { status: "scored", score: 5 } }).overall,
    ).toBe(10);
  });

  it("handles gates: disqualify, cap, flag", () => {
    const base = c("a", { weight: 100 });
    const gate = (onFail: "disqualify" | "cap" | "flag") =>
      c("g", { type: "gate", weight: 0, gateConfig: { onFail, capAt: onFail === "cap" ? 5 : null } });
    const inputs = { a: { status: "scored" as const, score: 9 }, g: { status: "gate_fail" as const } };
    expect(computeScore(rubric([base, gate("disqualify")]), inputs).disqualified).toBe(true);
    const capped = computeScore(rubric([base, gate("cap")]), inputs);
    expect(capped.overall).toBe(5);
    expect(capped.capped).toBe(true);
    const flagged = computeScore(rubric([base, gate("flag")]), inputs);
    expect(flagged.overall).toBe(9);
    expect(flagged.warnings.join()).toMatch(/failed/);
    expect(
      computeScore(rubric([base, gate("disqualify")]), { ...inputs, g: { status: "gate_fail", override: 1 } })
        .disqualified,
    ).toBe(false);
  });

  it("returns null overall when nothing is scorable", () => {
    expect(computeScore(rubric([c("a", { weight: 100 })]), {}).overall).toBeNull();
  });

  it("clamps out-of-range scores", () => {
    expect(
      computeScore(rubric([c("a", { weight: 100 })]), { a: { status: "scored", score: 14 } }).overall,
    ).toBe(10);
  });
});

describe("letterFor", () => {
  it("maps percent to bands", () => {
    const bands = emptyRubric().gradeBands;
    expect(letterFor(85, bands)).toBe("A");
    expect(letterFor(84.9, bands)).toBe("B");
    expect(letterFor(0, bands)).toBe("F");
  });
});

describe("compareForRanking", () => {
  const r = rubric([c("big", { weight: 70 }), c("small", { weight: 30 })]);
  it("orders by overall, then by highest-weight criterion", () => {
    const a = computeScore(r, { big: { status: "scored", score: 8 }, small: { status: "scored", score: 2 } }); // 6.2
    const b = computeScore(r, {
      big: { status: "scored", score: 6 },
      small: { status: "scored", score: 6.67 },
    }); // 6.2
    expect(a.overall).toBe(b.overall);
    expect(compareForRanking(r, a, b)).toBeLessThan(0);
    expect(compareForRanking(r, a, a)).toBe(0);
  });
});

describe("median", () => {
  it("handles odd and even counts", () => {
    expect(median([3, 9, 5])).toBe(5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

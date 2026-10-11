import { describe, expect, it } from "vitest";
import { mergeRuns } from "./report";
import { emptyRubric, type Criterion } from "./rubric/schema";

const anchors = Array.from({ length: 5 }, () => ({ band: "b", description: "d" }));
const crit = (id: string, over: Partial<Criterion> = {}): Criterion => ({
  id,
  name: id,
  description: "",
  lookFor: [],
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
const ev = (verified: boolean) => ({
  id: "e",
  criterionScoreId: "s",
  path: "a",
  startLine: 1,
  endLine: 1,
  quote: "q",
  kind: "strength" as const,
  severity: null,
  verified,
  verifyReason: null,
});
const run = (
  id: string,
  scores: {
    criterionId: string;
    status: "scored" | "insufficient_evidence" | "gate_pass" | "gate_fail";
    score: number | null;
    verified?: number;
  }[],
) =>
  ({
    id,
    criterionScores: scores.map((s) => ({
      id: `${id}-${s.criterionId}`,
      runId: id,
      criterionId: s.criterionId,
      status: s.status,
      score: s.score,
      confidence: "high" as const,
      rationale: `r-${id}`,
      improvement: "i",
      verifier: null,
      evidence: Array.from({ length: s.verified ?? 2 }, () => ev(true)).concat([ev(false)]),
    })),
  }) as never;

describe("mergeRuns (consensus)", () => {
  const rubric = {
    ...emptyRubric(),
    criteria: [crit("a"), crit("b"), crit("g", { type: "gate", weight: 0 })],
  };

  it("takes the median and flags spreads > 20% of the scale", () => {
    const { criteria, review } = mergeRuns(rubric, [
      run("r1", [
        { criterionId: "a", status: "scored", score: 6 },
        { criterionId: "b", status: "scored", score: 2 },
        { criterionId: "g", status: "gate_pass", score: null },
      ]),
      run("r2", [
        { criterionId: "a", status: "scored", score: 7 },
        { criterionId: "b", status: "scored", score: 9 },
        { criterionId: "g", status: "gate_pass", score: null },
      ]),
      run("r3", [
        { criterionId: "a", status: "scored", score: 6.5 },
        { criterionId: "b", status: "scored", score: 5 },
        { criterionId: "g", status: "gate_fail", score: null },
      ]),
    ]);
    const a = criteria.find((c) => c.criterionId === "a")!;
    const b = criteria.find((c) => c.criterionId === "b")!;
    expect(a.score).toBe(6.5);
    expect(a.lowAgreement).toBe(false);
    expect(b.score).toBe(5);
    expect(b.lowAgreement).toBe(true);
    expect(b.confidence).toBe("low");
    expect(criteria.find((c) => c.criterionId === "g")!.status).toBe("gate_pass");
    expect(review.join()).toMatch(/Low agreement on “b”/);
    expect(review.join()).toMatch(/gate “g”/);
    expect(a.verifiedEvidence).toBe(6);
    expect(a.discardedEvidence).toBe(3);
  });

  it("lowers confidence with fewer than 2 verified items and marks missing criteria", () => {
    const { criteria } = mergeRuns(rubric, [
      run("r1", [{ criterionId: "a", status: "scored", score: 6, verified: 1 }]),
    ]);
    expect(criteria.find((c) => c.criterionId === "a")!.confidence).toBe("low");
    expect(criteria.find((c) => c.criterionId === "b")!.status).toBe("missing");
  });
});

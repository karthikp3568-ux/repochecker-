import { describe, expect, it } from "vitest";
import { assignRanks, toCsv, type LeaderboardEntry } from "./leaderboard";
import { emptyRubric, type Criterion } from "./rubric/schema";
import { computeScore } from "./scoring";

describe("toCsv", () => {
  it("escapes quotes/commas and neutralizes formula injection", () => {
    const rubric = { ...emptyRubric(), criteria: [] };
    const entry = {
      rank: 1,
      tied: false,
      name: '=HYPERLINK("x")',
      team: 'A, "B"',
      status: "draft",
      overall: 7.5,
      percent: 75,
      letter: "B",
      disqualified: false,
      flags: 0,
      cells: {},
    } as unknown as LeaderboardEntry;
    const csv = toCsv(rubric, [entry]);
    const row = csv.split("\r\n")[1]!;
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain(`"A, ""B"""`);
  });
});

describe("assignRanks", () => {
  const anchors = Array.from({ length: 5 }, () => ({ band: "b", description: "d" }));
  const crit = (id: string, weight: number, over: Partial<Criterion> = {}): Criterion => ({
    id,
    name: id,
    description: "",
    lookFor: [],
    boundary: null,
    anchors,
    weight,
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
  const rubric = {
    ...emptyRubric(),
    criteria: [
      crit("big", 60),
      crit("small", 40),
      crit("gate", 0, { type: "gate", gateConfig: { onFail: "disqualify", capAt: null } }),
    ],
  };
  const entry = (
    name: string,
    big: number | null,
    small: number | null,
    gate: "gate_pass" | "gate_fail" = "gate_pass",
  ) => {
    const result = computeScore(rubric, {
      ...(big != null ? { big: { status: "scored", score: big } } : {}),
      ...(small != null ? { small: { status: "scored", score: small } } : {}),
      gate: { status: gate },
    });
    return {
      name,
      rank: null as number | null,
      tied: false,
      disqualified: result.disqualified,
      overall: result.overall,
      result,
    };
  };

  it("ranks by score, breaks ties by the heaviest criterion, shares ranks on true ties, separates DQs", () => {
    const entries = [
      entry("low", 2, 2),
      entry("tieA", 8, 2), // 5.6
      entry("tieB", 4, 8), // 5.6 overall, but lower on the 60-weight criterion
      entry("top", 9, 9),
      entry("twinA", 5, 5),
      entry("twinB", 5, 5), // identical → true tie
      entry("dq", 10, 10, "gate_fail"),
      entry("unscored", null, null),
    ];
    const { ranked, unranked, disqualified } = assignRanks(rubric, entries);
    expect(ranked.map((e) => `${e.rank}:${e.name}${e.tied ? "=" : ""}`)).toEqual([
      "1:top",
      "2:tieA",
      "3:tieB",
      "4:twinA=",
      "4:twinB=",
      "6:low",
    ]);
    expect(disqualified.map((e) => e.name)).toEqual(["dq"]);
    expect(unranked.map((e) => e.name)).toEqual(["unscored"]);
  });
});

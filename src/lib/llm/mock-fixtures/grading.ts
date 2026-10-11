/** Mock responders for the verifier and compare tasks. */
import { registerMock } from "../mock";
import { tag } from "./text";

registerMock("verify", (req) => {
  const scores = tag(req.user, "scores");
  const excerpts = tag(req.user, "evidence_excerpts");
  const verdicts = [...scores.matchAll(/^\[([^\]]+)\] [^\n]*status=(\w+)/gm)].map((m) => {
    const id = m[1]!;
    const hasEvidence = excerpts.includes(`[${id}]`);
    const scored = m[2] === "scored";
    return {
      criterionId: id,
      verdict: scored && !hasEvidence ? ("insufficient" as const) : ("agree" as const),
      suggestedScore: null,
      note: hasEvidence
        ? "Mock verifier: score consistent with the excerpts."
        : "Mock verifier: no verified excerpts shown.",
    };
  });
  return { verdicts, crossCriterionIssues: [] };
});

registerMock("compare", (req) => {
  const names = [...req.user.matchAll(/^## (.+?) — rank (\d+)/gm)].map((m) => m[1]!);
  const ids = [...req.user.matchAll(/^- \[([^\]]+)\]/gm)].map((m) => m[1]!);
  return {
    summary: `Mock comparison: ${names[0] ?? "The first submission"} ranks above ${names.slice(1).join(" and ") || "the others"} mainly on the highest-weighted criteria; see the side-by-side scores.`,
    keyDifferences: [...new Set(ids)].slice(0, 3).map((id) => ({
      criterionId: id,
      explanation: "Mock: score gap on this criterion contributes to the ranking.",
    })),
  };
});

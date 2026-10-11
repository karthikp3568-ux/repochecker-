/**
 * LLM verifier pass (spec §5.4). Gets the rubric, the agent's scores/rationales and code excerpts
 * for *verified* evidence fetched by the system. Never changes scores — it only reports verdicts.
 */
import { readFile } from "node:fs/promises";
import { AUX_EFFORT } from "../config";
import { redactSecrets } from "../ingest/scanners";
import { llm } from "../llm/client";
import type { Usage } from "../llm/pricing";
import {
  VERIFIER_SYSTEM,
  VerifierOutputSchema,
  verifierUserMessage,
  type VerifierOutput,
} from "../llm/prompts/verifier";
import { renderRubric } from "../rubric/render";
import type { Rubric } from "../rubric/schema";
import { resolveInside } from "./fs-tools";

export type ScoreForVerifier = {
  criterionId: string;
  status: string;
  score: number | null;
  confidence: string;
  rationale: string;
  evidence: { path: string; startLine: number; endLine: number; kind: string; verified: boolean }[];
};

const MAX_EXCERPT_LINES = 40;

async function excerpts(root: string, scores: ScoreForVerifier[]): Promise<string> {
  const out: string[] = [];
  let budget = 60_000;
  for (const s of scores) {
    for (const e of s.evidence.filter((x) => x.verified)) {
      try {
        const { abs, rel } = await resolveInside(root, e.path);
        const lines = (await readFile(abs, "utf8")).split(/\r?\n/);
        const lo = Math.max(1, e.startLine - 2);
        const hi = Math.min(lines.length, Math.max(e.endLine, e.startLine) + 2, lo + MAX_EXCERPT_LINES);
        const body = lines
          .slice(lo - 1, hi)
          .map((l, i) => `${lo + i}  ${l}`)
          .join("\n");
        const block = `[${s.criterionId}] ${rel}:${lo}-${hi} (${e.kind})\n${redactSecrets(body)}`;
        if (budget - block.length < 0) break;
        budget -= block.length;
        out.push(block);
      } catch {
        // file vanished — skip
      }
    }
  }
  return out.join("\n\n") || "(no verified evidence)";
}

export async function runVerifier(input: {
  root: string;
  rubric: Rubric;
  scores: ScoreForVerifier[];
}): Promise<{ output: VerifierOutput; usage: Usage; model: string }> {
  const scoresText = input.scores
    .map((s) => {
      const c = input.rubric.criteria.find((x) => x.id === s.criterionId);
      return `[${s.criterionId}] ${c?.name ?? "?"}: status=${s.status} score=${s.score ?? "—"} confidence=${s.confidence}\nRationale: ${s.rationale}`;
    })
    .join("\n\n");
  const { data, usage, model } = await llm().structured({
    task: "verify",
    system: VERIFIER_SYSTEM,
    user: verifierUserMessage({
      rubricText: renderRubric(input.rubric),
      scoresText,
      excerpts: await excerpts(input.root, input.scores),
    }),
    schema: VerifierOutputSchema,
    effort: AUX_EFFORT,
    maxTokens: 16000,
  });
  return { output: data, usage, model };
}

/** Does the verifier's disagreement require human review? (spec §5.4) */
export function verifierNeedsReview(
  rubric: Rubric,
  scores: ScoreForVerifier[],
  output: VerifierOutput,
): string[] {
  const reasons: string[] = [];
  const span = rubric.scale.max - rubric.scale.min;
  for (const v of output.verdicts) {
    const c = rubric.criteria.find((x) => x.id === v.criterionId);
    const s = scores.find((x) => x.criterionId === v.criterionId);
    if (!c || !s) continue;
    if (
      v.verdict === "adjust" &&
      v.suggestedScore != null &&
      s.score != null &&
      Math.abs(v.suggestedScore - s.score) >= 0.2 * span
    ) {
      reasons.push(
        `Verifier disagreed on “${c.name}” (suggests ${v.suggestedScore}, agent gave ${s.score}).`,
      );
    }
    if (v.verdict === "insufficient" && c.weight >= 15) {
      reasons.push(`Verifier found insufficient evidence for “${c.name}” (weight ${c.weight}).`);
    }
  }
  return reasons;
}

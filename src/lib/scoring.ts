/**
 * Final score computation (spec §5.5). Pure, deterministic, no I/O — the LLM never computes totals.
 */
import type { Criterion, Rubric } from "./rubric/schema";

export type CriterionInput = {
  /** AI result after consensus. */
  status?: "scored" | "insufficient_evidence" | "gate_pass" | "gate_fail" | null;
  score?: number | null;
  /** Latest human override (replaces AI score). For gates: >0 = pass, 0 = fail. */
  override?: number | null;
  /** Score entered by a human for scorer=human criteria. */
  human?: number | null;
};

export type CriterionOutcome = {
  criterionId: string;
  type: Criterion["type"];
  weight: number;
  /** Effective score on the rubric scale (bonus: points), or null if excluded. */
  score: number | null;
  norm: number | null;
  /** Contribution to the overall in scale points (scored criteria only). */
  weightedPoints: number | null;
  source: "ai" | "override" | "human" | "excluded" | "zeroed";
  gate?: "pass" | "fail" | "unknown";
};

export type ScoreResult = {
  /** Overall on the rubric scale, 1 decimal; null if nothing could be scored. */
  overall: number | null;
  percent: number | null;
  letter: string | null;
  disqualified: boolean;
  capped: boolean;
  warnings: string[];
  criteria: CriterionOutcome[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function normalize(score: number, scale: { min: number; max: number }): number {
  return clamp((score - scale.min) / (scale.max - scale.min), 0, 1);
}

export function letterFor(percent: number, bands: Rubric["gradeBands"]): string | null {
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find((b) => percent >= b.minPercent - 1e-9)?.letter ?? sorted.at(-1)?.letter ?? null;
}

export function computeScore(
  rubric: Rubric,
  inputs: Record<string, CriterionInput>,
  opts: { treatInsufficientAsZero?: boolean } = {},
): ScoreResult {
  const { scale } = rubric;
  const span = scale.max - scale.min;
  const warnings: string[] = [];
  const outcomes: CriterionOutcome[] = [];
  let weightSum = 0;
  let weighted = 0;
  let bonusNorm = 0;
  let disqualified = false;
  let capAt: number | null = null;

  for (const c of rubric.criteria) {
    const inp = inputs[c.id] ?? {};
    if (c.type === "gate") {
      let gate: "pass" | "fail" | "unknown" = "unknown";
      let source: CriterionOutcome["source"] = "ai";
      if (inp.override != null) {
        gate = inp.override > 0 ? "pass" : "fail";
        source = "override";
      } else if (c.scorer === "human") {
        source = "human";
        if (inp.human != null) gate = inp.human > 0 ? "pass" : "fail";
      } else if (inp.status === "gate_pass") gate = "pass";
      else if (inp.status === "gate_fail") gate = "fail";
      if (gate === "unknown") warnings.push(`Gate “${c.name}” has no result yet.`);
      if (gate === "fail") {
        const onFail = c.gateConfig?.onFail ?? "flag";
        if (onFail === "disqualify") disqualified = true;
        else if (onFail === "cap" && c.gateConfig?.capAt != null)
          capAt = capAt == null ? c.gateConfig.capAt : Math.min(capAt, c.gateConfig.capAt);
        else warnings.push(`Gate “${c.name}” failed (flagged).`);
      }
      outcomes.push({
        criterionId: c.id,
        type: c.type,
        weight: 0,
        score: null,
        norm: null,
        weightedPoints: null,
        source,
        gate,
      });
      continue;
    }

    // Effective score: override > human (for human criteria) > AI.
    let score: number | null = null;
    let source: CriterionOutcome["source"] = "excluded";
    if (inp.override != null) {
      score = inp.override;
      source = "override";
    } else if (c.scorer === "human") {
      if (inp.human != null) {
        score = inp.human;
        source = "human";
      } else warnings.push(`“${c.name}” needs a human score; excluded from the total until scored.`);
    } else if (inp.status === "scored" && inp.score != null) {
      score = inp.score;
      source = "ai";
    } else if (opts.treatInsufficientAsZero && c.type === "scored") {
      score = scale.min;
      source = "zeroed";
      warnings.push(`“${c.name}” had insufficient evidence and was scored as ${scale.min}.`);
    } else {
      warnings.push(`“${c.name}” has insufficient evidence; excluded and weights renormalized.`);
    }

    if (c.type === "bonus") {
      const max = c.bonusMax ?? 0;
      const pts = score == null ? null : clamp(score, 0, max);
      if (pts != null) bonusNorm += pts / span;
      outcomes.push({
        criterionId: c.id,
        type: c.type,
        weight: 0,
        score: pts,
        norm: pts == null || max === 0 ? null : pts / max,
        weightedPoints: null,
        source,
      });
      continue;
    }

    const s = score == null ? null : clamp(score, scale.min, scale.max);
    const norm = s == null ? null : normalize(s, scale);
    if (norm != null) {
      weightSum += c.weight;
      weighted += c.weight * norm;
    }
    outcomes.push({
      criterionId: c.id,
      type: c.type,
      weight: c.weight,
      score: s,
      norm,
      weightedPoints: null,
      source,
    });
  }

  if (weightSum === 0) {
    return {
      overall: null,
      percent: null,
      letter: null,
      disqualified,
      capped: false,
      warnings,
      criteria: outcomes,
    };
  }

  // Weighted points on the rubric scale, using renormalized weights.
  for (const o of outcomes) {
    if (o.type === "scored" && o.norm != null)
      o.weightedPoints = round1((o.weight / weightSum) * o.norm * span * 100) / 100;
  }

  let norm = clamp(weighted / weightSum + bonusNorm, 0, 1);
  let capped = false;
  if (capAt != null) {
    const capNorm = normalize(capAt, scale);
    if (norm > capNorm) {
      norm = capNorm;
      capped = true;
      warnings.push(`A gate failed; the overall score is capped at ${capAt}.`);
    }
  }
  const percent = round1(norm * 100);
  return {
    overall: round1(scale.min + norm * span),
    percent,
    letter: letterFor(percent, rubric.gradeBands),
    disqualified,
    capped,
    warnings,
    criteria: outcomes,
  };
}

/**
 * Ranking comparator: higher overall first; ties broken by the highest-weight criterion's
 * normalized score, then the next. Returns <0 if a ranks above b; 0 = true tie.
 */
export function compareForRanking(
  rubric: Rubric,
  a: Pick<ScoreResult, "overall" | "criteria">,
  b: Pick<ScoreResult, "overall" | "criteria">,
): number {
  const ao = a.overall ?? -Infinity;
  const bo = b.overall ?? -Infinity;
  if (ao !== bo) return bo - ao;
  const order = rubric.criteria
    .filter((c) => c.type === "scored")
    .map((c, i) => ({ c, i }))
    .sort((x, y) => y.c.weight - x.c.weight || x.i - y.i);
  for (const { c } of order) {
    const an = a.criteria.find((o) => o.criterionId === c.id)?.norm ?? -1;
    const bn = b.criteria.find((o) => o.criterionId === c.id)?.norm ?? -1;
    if (an !== bn) return bn - an;
  }
  return 0;
}

/** Median for consensus mode. */
export function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

import type { EvaluationContext, Purpose, Rubric } from "./schema";

export const PURPOSE_LABELS: Record<Purpose, string> = {
  hackathon: "Hackathon",
  course: "Course assignment",
  hiring: "Hiring take-home",
  audit: "Codebase audit",
  self_review: "Self-review",
  other: "Other",
};

/** Deterministic plain-text context block for prompts. Same input → same bytes (prompt caching). */
export function renderContext(purpose: string, ctx: EvaluationContext): string {
  const lines = [`Purpose: ${PURPOSE_LABELS[purpose as Purpose] ?? purpose}`];
  if (ctx.timeLimit) lines.push(`Time constraint: ${ctx.timeLimit}`);
  if (ctx.deadline) lines.push(`Deadline: ${ctx.deadline}`);
  if (ctx.teamSize) lines.push(`Team size: ${ctx.teamSize}`);
  if (ctx.experienceLevel) lines.push(`Experience level: ${ctx.experienceLevel}`);
  if (ctx.expectedStack) lines.push(`Expected stack: ${ctx.expectedStack}`);
  lines.push(ctx.brief.trim() ? `Brief / problem statement:\n${ctx.brief.trim()}` : "Brief: (none provided)");
  return lines.join("\n");
}

/** Deterministic rubric rendering for the grader/verifier prompts. */
export function renderRubric(rubric: Rubric): string {
  const out: string[] = [];
  out.push(`Scale: ${rubric.scale.min}–${rubric.scale.max} (higher is better).`);
  out.push(`Summary: ${rubric.summary}`);
  for (const c of rubric.criteria) {
    out.push("");
    const kind =
      c.type === "scored"
        ? `scored, weight ${c.weight}`
        : c.type === "gate"
          ? `GATE (pass/fail; on fail: ${c.gateConfig?.onFail ?? "flag"})`
          : `BONUS (up to ${c.bonusMax ?? 0} points)`;
    out.push(`## ${c.name}  [id: ${c.id}] (${kind}; scorer: ${c.scorer}; assessability: ${c.assessability})`);
    out.push(c.description);
    if (c.boundary) out.push(`Does NOT cover: ${c.boundary}`);
    if (c.assessabilityNote) out.push(`Assessability note: ${c.assessabilityNote}`);
    out.push("Look for:");
    for (const s of c.lookFor) out.push(`- ${s}`);
    out.push("Anchors:");
    for (const a of c.anchors) out.push(`- ${a.band}: ${a.description}`);
  }
  return out.join("\n");
}

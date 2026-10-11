import { route } from "@/lib/api";
import { requireReport } from "@/lib/report-access";
import { loadReportView } from "@/lib/report-view";

/** Full report as JSON (also the JSON export with ?download=1). Snippet HTML is omitted. */
export const GET = route<{ id: string }>(async ({ req, params, user }) => {
  await requireReport(params.id, user.id);
  const view = (await loadReportView(params.id))!;
  const body = {
    exportedAt: new Date().toISOString(),
    evaluation: view.evaluation,
    submission: view.submission,
    rubricVersion: view.rubricVersion,
    rubric: view.rubric,
    status: view.report.status,
    score: {
      ai: view.ai.overall,
      final: view.final.overall,
      percent: view.final.percent,
      letter: view.final.letter,
      disqualified: view.final.disqualified,
    },
    summary: view.report.summary,
    criteria: view.criteria.map((c) => ({
      id: c.criterion.id,
      name: c.criterion.name,
      type: c.criterion.type,
      weight: c.criterion.weight,
      score: c.outcome?.score ?? null,
      gate: c.outcome?.gate ?? null,
      source: c.outcome?.source ?? null,
      confidence: c.merged?.confidence ?? null,
      rationale: c.merged?.rationale ?? null,
      improvement: c.merged?.improvement ?? null,
      verifier: c.merged?.verifier ?? null,
      evidence: c.evidence.filter((e) => e.verified).map(({ html: _html, ...e }) => e),
      discardedEvidence: c.evidence.filter((e) => !e.verified).map(({ html: _html, ...e }) => e),
      overrides: c.overrides,
      humanScore: c.human,
    })),
    flags: view.flags,
    recommendations: view.report.recommendations,
    coverage: view.report.coverage,
    warnings: view.report.warnings,
    comments: view.comments,
    usage: view.usage,
  };
  const download = new URL(req.url).searchParams.get("download");
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(download
        ? {
            "content-disposition": `attachment; filename="${view.submission.displayName.replace(/[^\w.-]+/g, "_")}-report.json"`,
          }
        : {}),
    },
  });
});

import {
  AlertTriangle,
  Ban,
  ExternalLink,
  FileText,
  Search,
  ShieldCheck,
  Terminal,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { SCORE_BG, scoreStep } from "@/components/workspace/score-chip";
import type { CriterionView, ReportView } from "@/lib/report-view";
import { cn } from "@/lib/utils";
import { Comments } from "./comments";
import { EvidenceCard } from "./evidence-card";
import { FlagsPanel } from "./flags-panel";
import { RadarChart } from "./radar-chart";
import { ReportActions } from "./report-actions";
import { ReviewControls } from "./review-controls";
import { ScoreRing } from "./score-ring";

const STATUS: Record<string, { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  needs_review: { label: "Needs review", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  disqualified: { label: "Disqualified", tone: "danger" },
};
const CONF_TONE = { high: "success", medium: "info", low: "warning" } as const;
const VERIFIER = {
  agree: { label: "Agrees", tone: "success" },
  adjust: { label: "Disagreed", tone: "warning" },
  insufficient: { label: "Insufficient", tone: "warning" },
} as const;
const LEVEL = { high: "danger", medium: "warning", low: "neutral" } as const;

export type ReportMode = "app" | "share" | "print";

function fmtScore(v: CriterionView) {
  const c = v.criterion;
  const o = v.outcome;
  if (c.type === "gate") return o?.gate === "pass" ? "Pass" : o?.gate === "fail" ? "Fail" : "—";
  if (o?.score == null)
    return v.merged?.status === "insufficient_evidence"
      ? "Insufficient"
      : c.scorer === "human"
        ? "Awaiting judge"
        : "—";
  return `${o.score}${c.type === "bonus" ? ` / ${c.bonusMax} bonus` : ""}`;
}

export function ReportBody({
  view,
  mode,
  canEdit,
}: {
  view: ReportView;
  mode: ReportMode;
  canEdit: boolean;
}) {
  const { report, submission, rubric, final, ai } = view;
  const s = STATUS[report.status] ?? STATUS.draft!;
  const interactive = mode === "app";
  const scored = view.criteria.filter((c) => c.criterion.type === "scored");
  const ordered = [...view.criteria].sort((a, b) => b.criterion.weight - a.criterion.weight);
  const topId = ordered[0]?.criterion.id;
  const pendingHuman = view.criteria.filter(
    (c) =>
      c.criterion.scorer === "human" &&
      c.outcome?.score == null &&
      c.outcome?.gate !== "pass" &&
      c.outcome?.gate !== "fail",
  ).length;
  const radar = scored
    .filter((c) => c.outcome?.norm != null)
    .map((c) => ({
      criterion: c.criterion.name.length > 18 ? `${c.criterion.name.slice(0, 17)}…` : c.criterion.name,
      score: Math.round((c.outcome!.norm ?? 0) * 100),
    }));
  const generalComments = view.comments.filter((c) => !c.criterionId);

  return (
    <article className="flex flex-col gap-8" aria-labelledby="report-title">
      {/* Header */}
      <header className="flex flex-col gap-2">
        {mode === "app" && (
          <Link
            href={`/app/evaluations/${view.evaluation.id}/submissions`}
            className="text-muted-foreground text-sm hover:underline print:hidden"
          >
            ← {view.evaluation.name}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="report-title" className="text-2xl font-semibold tracking-tight">
            {submission.displayName}
          </h1>
          <Badge tone={s.tone}>{s.label}</Badge>
          {view.consensusPasses > 1 && (
            <Badge tone="info">
              <Users className="size-3" aria-hidden /> {view.consensusPasses}-pass consensus
            </Badge>
          )}
          {view.verifierDisagreed && (
            <Badge tone="warning">
              <AlertTriangle className="size-3" aria-hidden /> Verifier disagreed
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {submission.teamName && <span>{submission.teamName}</span>}
          {submission.treeUrl ? (
            <a
              href={submission.treeUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent inline-flex items-center gap-1 font-mono hover:underline"
            >
              {submission.repoUrl?.replace(/^https:\/\/(www\.)?/, "")} @ {submission.commitSha.slice(0, 7)}{" "}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : (
            <span className="font-mono">
              {submission.sourceType === "zip" ? "ZIP upload" : submission.repoUrl} @{" "}
              {submission.commitSha.slice(0, 10)}
            </span>
          )}
          <span>Rubric v{view.rubricVersion.version}</span>
          <span>
            Graded <time dateTime={report.updatedAt}>{new Date(report.updatedAt).toLocaleString()}</time>
          </span>
          {report.approvedBy && (
            <span className="text-success inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5" aria-hidden /> Approved by {report.approvedBy}
            </span>
          )}
        </p>
      </header>

      {interactive && (
        <ReportActions
          reportId={report.id}
          evaluationId={view.evaluation.id}
          submissionId={submission.id}
          status={report.status}
          canEdit={canEdit}
          pendingHuman={pendingHuman}
          shareToken={report.shareToken}
          shareOptions={report.shareOptions}
        />
      )}

      {/* Disqualified banner */}
      {final.disqualified && (
        <section role="alert" className="border-danger/50 bg-danger/5 rounded-xl border p-5">
          <h2 className="text-danger flex items-center gap-2 font-semibold">
            <Ban className="size-4" aria-hidden /> Disqualified
          </h2>
          {view.failedGates.map((g) => {
            const cv = view.criteria.find((c) => c.criterion.id === g.id);
            return (
              <div key={g.id} className="mt-2 text-sm">
                <p>
                  Failed gate <b>{g.name}</b>: {cv?.merged?.rationale ?? g.description}
                </p>
                {cv?.evidence
                  .filter((e) => e.verified)
                  .slice(0, 2)
                  .map((e) => (
                    <div key={e.id} className="mt-2">
                      <EvidenceCard e={e} />
                    </div>
                  ))}
              </div>
            );
          })}
        </section>
      )}

      {/* Hero */}
      <section
        className="border-border bg-card grid gap-6 rounded-xl border p-6 md:grid-cols-[auto_1fr]"
        aria-label="Overall score"
      >
        <div className="flex justify-center">
          <ScoreRing
            value={final.overall}
            max={rubric.scale.max}
            percent={final.percent}
            letter={final.letter}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-base leading-relaxed">{report.summary}</p>
          {view.overrideCount > 0 && ai.overall !== final.overall && (
            <p className="text-sm">
              AI <b className="font-mono">{ai.overall?.toFixed(1) ?? "—"}</b> → Final{" "}
              <b className="font-mono">{final.overall?.toFixed(1) ?? "—"}</b>{" "}
              <span className="text-muted-foreground">
                ({view.overrideCount} override{view.overrideCount === 1 ? "" : "s"})
              </span>
            </p>
          )}
          <div>
            <p className="text-muted-foreground text-xs">Overall confidence</p>
            <div className="mt-1 flex items-center gap-2">
              <meter
                min={0}
                max={1}
                low={0.45}
                high={0.8}
                optimum={1}
                value={view.overallConfidence}
                className="h-2 w-40"
                aria-label="Overall confidence"
              />
              <span className="text-sm">
                {view.overallConfidence >= 0.8 ? "High" : view.overallConfidence >= 0.45 ? "Medium" : "Low"}
              </span>
            </div>
          </div>
          {(report.warnings.review.length > 0 || final.warnings.length > 0) && (
            <ul className="text-muted-foreground space-y-0.5 text-xs">
              {[...report.warnings.review, ...final.warnings].map((w, i) => (
                <li key={i} className="flex gap-1.5">
                  <AlertTriangle className="text-warning mt-0.5 size-3 shrink-0" aria-hidden /> {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <FlagsPanel flags={view.flags} />

      {/* Scorecard */}
      <section
        aria-labelledby="scorecard-h"
        className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
      >
        <div className="border-border bg-card rounded-xl border p-4">
          <h2 id="scorecard-h" className="mb-2 text-sm font-semibold">
            Scorecard
          </h2>
          {mode === "print" ? null : (
            <RadarChart
              data={radar}
              series={[{ key: "score", label: submission.displayName, color: "var(--accent)" }]}
              label={`Radar chart of ${radar.length} criterion scores (percent). The table lists the same data.`}
            />
          )}
        </div>
        <div className="border-border relative overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Per-criterion scores</caption>
            <thead className="bg-muted/60 text-muted-foreground text-left text-xs">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Criterion
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Weight
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Score
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Points
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Confidence
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Verifier
                </th>
              </tr>
            </thead>
            <tbody>
              {view.criteria.map((v) => {
                const pct = v.outcome?.norm != null ? Math.round(v.outcome.norm * 100) : null;
                return (
                  <tr key={v.criterion.id} className="border-border border-t">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      <a href={`#c-${v.criterion.id}`} className="hover:underline">
                        {v.criterion.name}
                      </a>
                      {v.criterion.type !== "scored" && (
                        <span className="text-muted-foreground ml-1 text-xs">({v.criterion.type})</span>
                      )}
                    </th>
                    <td className="px-3 py-2 text-right font-mono">
                      {v.criterion.type === "scored" ? v.criterion.weight : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {pct != null && v.criterion.type === "scored" && (
                          <span className="bg-muted h-1.5 w-16 overflow-hidden rounded-full" aria-hidden>
                            <span
                              className={cn("block h-full", SCORE_BG[scoreStep(pct)])}
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                        )}
                        <span className="font-mono text-xs">{fmtScore(v)}</span>
                        {v.outcome?.source === "override" && <Badge tone="accent">Override</Badge>}
                        {v.outcome?.source === "human" && <Badge tone="info">Human</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {v.outcome?.weightedPoints?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {v.merged ? (
                        <Badge tone={CONF_TONE[v.merged.confidence]}>{v.merged.confidence}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {v.merged?.verifier ? (
                        <Badge tone={VERIFIER[v.merged.verifier.verdict].tone}>
                          {VERIFIER[v.merged.verifier.verdict].label}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Criterion sections */}
      <section aria-labelledby="criteria-h" className="flex flex-col gap-3">
        <h2 id="criteria-h" className="text-lg font-semibold">
          Criteria
        </h2>
        {ordered.map((v) => {
          const c = v.criterion;
          const verified = v.evidence.filter((e) => e.verified);
          const discarded = v.evidence.filter((e) => !e.verified);
          const comments = view.comments.filter((x) => x.criterionId === c.id);
          const range =
            c.type === "gate"
              ? { min: 0, max: 1, step: 1, gate: true }
              : c.type === "bonus"
                ? { min: 0, max: c.bonusMax ?? 1, step: 0.1 }
                : {
                    min: rubric.scale.min,
                    max: rubric.scale.max,
                    step: rubric.scale.max - rubric.scale.min > 20 ? 1 : 0.5,
                  };
          return (
            <details
              key={c.id}
              id={`c-${c.id}`}
              open={mode === "print" || c.id === topId}
              className="border-border bg-card group scroll-mt-20 rounded-xl border"
            >
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1 font-semibold">{c.name}</span>
                {c.type === "scored" && (
                  <span className="text-muted-foreground text-xs">weight {c.weight}</span>
                )}
                <span className="font-mono text-sm font-semibold">{fmtScore(v)}</span>
                {v.band && <Badge>{v.band.band}</Badge>}
                {v.merged && (
                  <Badge tone={CONF_TONE[v.merged.confidence]}>{v.merged.confidence} confidence</Badge>
                )}
              </summary>
              <div className="border-border flex flex-col gap-4 border-t p-4">
                <p className="text-muted-foreground text-sm">{c.description}</p>
                {v.band && (
                  <p className="text-sm">
                    <span className="font-medium">Band {v.band.band}:</span> {v.band.description}
                  </p>
                )}
                {c.scorer === "human" && !v.merged && (
                  <p className="text-sm">
                    This criterion is scored by a human judge (
                    {c.assessabilityNote ?? "not assessable from the repository"}).
                  </p>
                )}
                {v.merged && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <h3 className="text-xs font-semibold tracking-wide uppercase">Rationale</h3>
                      <p className="mt-1 text-sm">{v.merged.rationale}</p>
                    </div>
                    {v.merged.improvement && (
                      <div>
                        <h3 className="text-xs font-semibold tracking-wide uppercase">
                          How to raise this score
                        </h3>
                        <p className="mt-1 text-sm">{v.merged.improvement}</p>
                      </div>
                    )}
                  </div>
                )}
                {v.merged?.verifier && v.merged.verifier.verdict !== "agree" && (
                  <p className="border-warning/40 bg-warning/5 rounded-lg border p-3 text-sm">
                    <b>
                      Verifier{" "}
                      {v.merged.verifier.verdict === "adjust"
                        ? `suggests ${v.merged.verifier.suggestedScore}`
                        : "found the evidence insufficient"}
                      :
                    </b>{" "}
                    {v.merged.verifier.note}
                  </p>
                )}
                {v.merged?.lowAgreement && (
                  <p className="text-warning text-sm">
                    Consensus passes disagreed (spread {v.merged.spread}); the median is shown.
                  </p>
                )}
                {verified.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold tracking-wide uppercase">
                      Evidence ({verified.length})
                    </h3>
                    {verified.map((e) => (
                      <EvidenceCard key={e.id} e={e} />
                    ))}
                  </div>
                )}
                {discarded.length > 0 && (
                  <details className="text-sm">
                    <summary className="text-muted-foreground cursor-pointer">
                      Discarded evidence ({discarded.length})
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {discarded.map((e) => (
                        <li key={e.id} className="text-muted-foreground">
                          <span className="font-mono text-xs">
                            {e.path}:{e.startLine}
                          </span>{" "}
                          — {e.verifyReason ?? "could not be verified"}
                          <q className="ml-1 font-mono text-xs">{e.quote.slice(0, 120)}</q>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {v.overrides.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold tracking-wide uppercase">Override history</h3>
                    <ul className="mt-1 space-y-1 text-sm">
                      {v.overrides.map((o) => (
                        <li key={o.id}>
                          <span className="font-mono">
                            {o.aiScore ?? "—"} → {o.newScore}
                          </span>{" "}
                          by {o.user} on {new Date(o.createdAt).toLocaleDateString()}: “{o.reason}”
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {v.human && (
                  <p className="text-sm">
                    Human score <b className="font-mono">{v.human.score}</b> by {v.human.user}
                    {v.human.note ? `: “${v.human.note}”` : ""}
                  </p>
                )}
                {interactive && canEdit && (
                  <ReviewControls
                    reportId={report.id}
                    criterionId={c.id}
                    criterionName={c.name}
                    mode={c.scorer === "human" ? "human" : "override"}
                    range={range}
                    current={c.scorer === "human" ? (v.human?.score ?? null) : (v.outcome?.score ?? null)}
                  />
                )}
                {interactive && (
                  <Comments
                    reportId={report.id}
                    criterionId={c.id}
                    comments={comments}
                    canComment={canEdit}
                    compact
                  />
                )}
                {!interactive && comments.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {comments.map((x) => (
                      <li key={x.id}>
                        <b>{x.user}:</b> {x.body}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          );
        })}
      </section>

      {report.recommendations.length > 0 && (
        <section aria-labelledby="recs-h" className="border-border bg-card rounded-xl border p-5">
          <h2 id="recs-h" className="font-semibold">
            Recommendations
          </h2>
          <ol className="mt-3 flex flex-col gap-2">
            {report.recommendations.map((r, i) => (
              <li key={i} className="flex flex-wrap items-start gap-2 text-sm">
                <span className="text-muted-foreground font-mono text-xs">{i + 1}.</span>
                <span className="min-w-0 flex-1">{r.text}</span>
                <Badge tone={LEVEL[r.impact]}>impact {r.impact}</Badge>
                <Badge>effort {r.effort}</Badge>
              </li>
            ))}
          </ol>
        </section>
      )}

      {report.crossIssues.length > 0 && (
        <section className="border-border bg-card rounded-xl border p-5">
          <h2 className="font-semibold">Cross-criterion notes from the verifier</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {report.crossIssues.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="coverage-h" className="border-border bg-card rounded-xl border p-5">
        <h2 id="coverage-h" className="font-semibold">
          Coverage
        </h2>
        <p className="mt-1 text-sm">
          The agent read <b>{report.coverage.filesRead}</b> of <b>{report.coverage.totalSourceFiles}</b>{" "}
          source files ({report.coverage.percent}%) using {report.coverage.toolCalls} tool calls.
          <span className="text-muted-foreground"> Measured from tool logs, not self-reported.</span>
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <details open={mode === "print"}>
            <summary className="cursor-pointer text-sm font-medium">
              <FileText className="mr-1 inline size-4" aria-hidden /> Files read (
              {report.coverage.readFiles.length})
            </summary>
            <ul className="mt-2 max-h-64 overflow-y-auto font-mono text-xs">
              {report.coverage.readFiles.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </details>
          <details open={mode === "print"}>
            <summary className="cursor-pointer text-sm font-medium">
              <Search className="mr-1 inline size-4" aria-hidden /> Searches (
              {report.coverage.searches.length})
            </summary>
            <ul className="mt-2 max-h-64 overflow-y-auto font-mono text-xs">
              {report.coverage.searches.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </details>
        </div>
        {view.execution.length > 0 && (
          <div className="mt-4">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <Terminal className="size-4" aria-hidden /> Execution results
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {view.execution.map((e) => (
                <li key={e.id}>
                  <details className="border-border rounded-lg border">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <Badge tone={e.exitCode === 0 ? "success" : "danger"}>exit {e.exitCode}</Badge>
                      <span className="text-muted-foreground text-xs">{e.phase}</span>
                      <code className="font-mono text-xs">{e.command}</code>
                      <span className="text-muted-foreground ml-auto text-xs">
                        {(e.durationMs / 1000).toFixed(1)}s
                      </span>
                    </summary>
                    <pre className="bg-muted max-h-72 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
                      {`${e.stdoutTail}\n${e.stderrTail}`.trim() || "(no output)"}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-muted-foreground mt-3 text-xs">
          Model {view.usage.model ?? "—"} · {(view.usage.tokensIn / 1000).toFixed(0)}k input /{" "}
          {(view.usage.tokensOut / 1000).toFixed(1)}k output tokens · ${view.usage.costUsd.toFixed(3)}
        </p>
      </section>

      {(interactive || generalComments.length > 0) && (
        <section aria-labelledby="comments-h" className="border-border bg-card rounded-xl border p-5">
          <h2 id="comments-h" className="mb-3 font-semibold">
            Comments
          </h2>
          {interactive ? (
            <Comments reportId={report.id} comments={generalComments} canComment={canEdit} />
          ) : (
            <ul className="space-y-1 text-sm">
              {generalComments.map((x) => (
                <li key={x.id}>
                  <b>{x.user}:</b> {x.body}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </article>
  );
}

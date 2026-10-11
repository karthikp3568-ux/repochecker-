/**
 * Report assembly (spec §5.3–5.5, §11.2). Merges a group of runs (consensus passes) into
 * per-criterion results, then computes AI and final scores with the pure scoring module.
 * Overrides and human scores are applied here; the LLM never computes totals.
 */
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { readSettings } from "./evaluation";
import { RubricSchema, type Rubric } from "./rubric/schema";
import { computeScore, median, type CriterionInput, type ScoreResult } from "./scoring";

export type MergedCriterion = {
  criterionId: string;
  status: "scored" | "insufficient_evidence" | "gate_pass" | "gate_fail" | "missing";
  score: number | null;
  confidence: "high" | "medium" | "low";
  passes: number;
  spread: number | null;
  lowAgreement: boolean;
  rationale: string;
  improvement: string;
  verifier: {
    verdict: "agree" | "adjust" | "insufficient";
    suggestedScore: number | null;
    note: string;
  } | null;
  verifiedEvidence: number;
  discardedEvidence: number;
  sourceRunId: string | null;
};

export type ReportWarnings = { review: string[]; scoring: string[] };

type RunWithScores = Prisma.RunGetPayload<{ include: { criterionScores: { include: { evidence: true } } } }>;

const CONF_RANK = { low: 0, medium: 1, high: 2 } as const;

export function mergeRuns(
  rubric: Rubric,
  runs: RunWithScores[],
): { criteria: MergedCriterion[]; review: string[] } {
  const span = rubric.scale.max - rubric.scale.min;
  const review: string[] = [];
  const criteria: MergedCriterion[] = [];
  for (const c of rubric.criteria) {
    if (c.scorer !== "ai") continue;
    const rows = runs.flatMap((r) =>
      r.criterionScores.filter((s) => s.criterionId === c.id).map((s) => ({ run: r, s })),
    );
    if (rows.length === 0) {
      criteria.push({
        criterionId: c.id,
        status: "missing",
        score: null,
        confidence: "low",
        passes: 0,
        spread: null,
        lowAgreement: false,
        rationale: "Not recorded by the grading agent.",
        improvement: "",
        verifier: null,
        verifiedEvidence: 0,
        discardedEvidence: 0,
        sourceRunId: null,
      });
      continue;
    }
    let status: MergedCriterion["status"];
    let score: number | null = null;
    let spread: number | null = null;
    if (c.type === "gate") {
      const pass = rows.filter((x) => x.s.status === "gate_pass").length;
      const fail = rows.filter((x) => x.s.status === "gate_fail").length;
      status = pass === 0 && fail === 0 ? "insufficient_evidence" : fail > pass ? "gate_fail" : "gate_pass";
      if (pass > 0 && fail > 0) review.push(`Passes disagreed on gate “${c.name}”.`);
    } else {
      const scored = rows.filter((x) => x.s.status === "scored" && x.s.score != null).map((x) => x.s.score!);
      if (scored.length * 2 >= rows.length && scored.length > 0) {
        status = "scored";
        score = Math.round(median(scored) * 10) / 10;
        spread = scored.length > 1 ? Math.max(...scored) - Math.min(...scored) : 0;
      } else status = "insufficient_evidence";
    }
    const unit = c.type === "bonus" ? Math.max(1e-9, c.bonusMax ?? 1) : span;
    const lowAgreement = spread != null && spread > 0.2 * unit;
    if (lowAgreement) review.push(`Low agreement on “${c.name}” across consensus passes (spread ${spread}).`);

    // Representative pass: the one closest to the merged score.
    const rep = [...rows].sort(
      (a, b) => Math.abs((a.s.score ?? 0) - (score ?? 0)) - Math.abs((b.s.score ?? 0) - (score ?? 0)),
    )[0]!;
    const evidence = rows.flatMap((x) => x.s.evidence);
    const verified = evidence.filter((e) => e.verified).length;
    let confidence = rows.map((x) => x.s.confidence).sort((a, b) => CONF_RANK[a] - CONF_RANK[b])[
      Math.floor(rows.length / 2)
    ]!;
    if (lowAgreement || (status === "scored" && verified < 2)) confidence = "low";
    criteria.push({
      criterionId: c.id,
      status,
      score,
      confidence,
      passes: rows.length,
      spread,
      lowAgreement,
      rationale: rep.s.rationale,
      improvement: rep.s.improvement,
      verifier: (rep.s.verifier as MergedCriterion["verifier"]) ?? null,
      verifiedEvidence: verified,
      discardedEvidence: evidence.length - verified,
      sourceRunId: rep.run.id,
    });
  }
  return { criteria, review };
}

export function scoreInputs(
  merged: MergedCriterion[],
  overrides: { criterionId: string; newScore: number }[],
  human: { criterionId: string; score: number }[],
  useOverrides: boolean,
): Record<string, CriterionInput> {
  const inputs: Record<string, CriterionInput> = {};
  for (const m of merged) {
    inputs[m.criterionId] = { status: m.status === "missing" ? null : m.status, score: m.score };
  }
  for (const h of human) inputs[h.criterionId] = { ...inputs[h.criterionId], human: h.score };
  if (useOverrides)
    for (const o of overrides) inputs[o.criterionId] = { ...inputs[o.criterionId], override: o.newScore };
  return inputs;
}

/** Latest row per criterion (overrides/human scores are append-only audit trails). */
function latest<T extends { criterionId: string; createdAt: Date }>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()))
    m.set(r.criterionId, r);
  return [...m.values()];
}

export async function recomputeReport(reportId: string): Promise<ScoreResult> {
  const report = await db.report.findUniqueOrThrow({
    where: { id: reportId },
    include: {
      overrides: true,
      humanScores: true,
      rubricVersion: true,
      submission: { include: { evaluation: true } },
    },
  });
  const rubric = RubricSchema.parse(report.rubricVersion.rubric);
  const settings = readSettings(report.submission.evaluation.settings);
  const merged = (report.criteria ?? []) as unknown as MergedCriterion[];
  const overrides = latest(report.overrides);
  const human = latest(report.humanScores);
  const opts = { treatInsufficientAsZero: settings.treatInsufficientAsZero };
  const ai = computeScore(rubric, scoreInputs(merged, overrides, human, false), opts);
  const final = computeScore(rubric, scoreInputs(merged, overrides, human, true), opts);

  const warnings = (report.warnings ?? { review: [], scoring: [] }) as ReportWarnings;
  const pendingHuman = rubric.criteria.filter(
    (c) =>
      c.scorer === "human" &&
      !human.some((h) => h.criterionId === c.id) &&
      !overrides.some((o) => o.criterionId === c.id),
  );
  const status =
    report.status === "approved"
      ? "approved"
      : final.disqualified
        ? "disqualified"
        : warnings.review.length > 0 || pendingHuman.length > 0
          ? "needs_review"
          : "draft";
  await db.report.update({
    where: { id: report.id },
    data: {
      aiOverall: ai.overall,
      finalOverall: final.overall,
      percent: final.percent,
      letter: final.letter,
      status,
      warnings: { review: warnings.review, scoring: final.warnings } satisfies ReportWarnings,
    },
  });
  return final;
}

/**
 * Build (or rebuild) the report for a run group once every run in it has ended.
 * Idempotent: concurrent callers converge on the same row via the unique key.
 */
export async function buildReportForGroup(groupId: string): Promise<string | null> {
  const runs = await db.run.findMany({
    where: { groupId },
    include: { criterionScores: { include: { evidence: true } } },
    orderBy: { consensusIndex: "asc" },
  });
  if (runs.length === 0) return null;
  if (runs.some((r) => !["COMPLETED", "NEEDS_REVIEW", "FAILED", "CANCELLED"].includes(r.status))) return null;
  const usable = runs.filter((r) => r.status === "COMPLETED" || r.status === "NEEDS_REVIEW");
  if (usable.length === 0) return null;

  const first = runs[0]!;
  const version = await db.rubricVersion.findUniqueOrThrow({ where: { id: first.rubricVersionId } });
  const rubric = RubricSchema.parse(version.rubric);
  const { criteria, review } = mergeRuns(rubric, usable);

  for (const r of usable) {
    const res = (r.result ?? {}) as { reviewReasons?: string[] };
    if (r.status === "NEEDS_REVIEW")
      review.push(
        ...(res.reviewReasons?.length
          ? res.reviewReasons
          : [`Run needs review (${r.statusReason ?? "unspecified"}).`]),
      );
  }
  if (usable.length < runs.length)
    review.push(`${runs.length - usable.length} of ${runs.length} consensus passes failed.`);

  const finish = usable
    .map(
      (r) =>
        (r.result ?? {}) as {
          finish?: { summary: string; recommendations: unknown[]; unassessed: string[] };
        },
    )
    .find((x) => x.finish)?.finish;
  const accesses = await db.fileAccess.findMany({ where: { runId: { in: usable.map((r) => r.id) } } });
  const snapshot = first.snapshotId
    ? await db.repoSnapshot.findUnique({ where: { id: first.snapshotId } })
    : null;
  const totalSource = (snapshot?.facts as { size?: { sourceFiles?: number } } | null)?.size?.sourceFiles ?? 0;
  const readFiles = [...new Set(accesses.filter((a) => a.kind === "read").map((a) => a.path))].sort();
  const searches = [
    ...new Set(accesses.filter((a) => a.kind === "search").map((a) => a.path.replace(/^search:/, ""))),
  ];
  const coverage = {
    filesRead: readFiles.length,
    totalSourceFiles: totalSource,
    percent: totalSource ? Math.round((readFiles.length / totalSource) * 1000) / 10 : 0,
    readFiles,
    searches,
    toolCalls: usable.reduce((n, r) => n + r.toolCalls, 0),
    runIds: usable.map((r) => r.id),
  };

  const uniqueReview = [...new Set(review)];
  const data = {
    runIds: runs.map((r) => r.id),
    summary: finish?.summary ?? "The grading agent did not provide a summary.",
    recommendations: (finish?.recommendations ?? []) as object[],
    criteria: criteria as unknown as object[],
    coverage,
    warnings: { review: uniqueReview, scoring: [] } satisfies ReportWarnings,
    status: "draft" as const,
    approvedById: null,
    approvedAt: null,
  };
  const report = await db.report.upsert({
    where: {
      submissionId_rubricVersionId: {
        submissionId: first.submissionId,
        rubricVersionId: first.rubricVersionId,
      },
    },
    update: data,
    create: { submissionId: first.submissionId, rubricVersionId: first.rubricVersionId, ...data },
  });
  await recomputeReport(report.id);
  return report.id;
}

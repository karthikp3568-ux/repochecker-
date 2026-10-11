/** Aggregated evaluation state for the workspace (submissions table, overview, live polling). */
import type { RunStatus } from "@/generated/prisma/client";
import { db } from "./db";
import type { MergedCriterion } from "./report";

export type SubmissionRow = {
  id: string;
  displayName: string;
  teamName: string | null;
  sourceType: string;
  repoUrl: string | null;
  commitSha: string;
  runs: {
    id: string;
    status: RunStatus;
    statusReason: string | null;
    consensusIndex: number;
    costUsd: number;
    toolCalls: number;
  }[];
  status: RunStatus | "NOT_STARTED";
  report: {
    id: string;
    status: string;
    finalOverall: number | null;
    percent: number | null;
    letter: string | null;
    lowConfidence: number;
  } | null;
  flags: number;
};

const STATUS_ORDER: RunStatus[] = [
  "FAILED",
  "GRADING",
  "VERIFYING",
  "SCORING",
  "EXECUTING",
  "INDEXING",
  "FETCHING",
  "QUEUED",
  "NEEDS_REVIEW",
  "CANCELLED",
  "COMPLETED",
];

export async function workspaceData(evaluationId: string, rubricVersionId: string | null) {
  const submissions = await db.submission.findMany({
    where: { evaluationId },
    orderBy: { createdAt: "asc" },
  });
  const ids = submissions.map((s) => s.id);
  const [runs, reports, flags] = await Promise.all([
    db.run.findMany({ where: { submissionId: { in: ids } }, orderBy: { createdAt: "desc" } }),
    rubricVersionId ? db.report.findMany({ where: { submissionId: { in: ids }, rubricVersionId } }) : [],
    db.integrityFlag.groupBy({
      by: ["runId"],
      where: { run: { submissionId: { in: ids } } },
      _count: { _all: true },
    }),
  ]);
  const flagByRun = new Map(flags.map((f) => [f.runId, f._count._all]));

  const rows: SubmissionRow[] = submissions.map((s) => {
    const own = runs.filter((r) => r.submissionId === s.id);
    const latestGroup = own[0]?.groupId;
    const group = own
      .filter((r) => r.groupId === latestGroup)
      .sort((a, b) => a.consensusIndex - b.consensusIndex);
    const status = group.length
      ? [...group].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))[0]!.status
      : "NOT_STARTED";
    const report = reports.find((r) => r.submissionId === s.id);
    const criteria = (report?.criteria ?? []) as unknown as MergedCriterion[];
    return {
      id: s.id,
      displayName: s.displayName,
      teamName: s.teamName,
      sourceType: s.sourceType,
      repoUrl: s.repoUrl,
      commitSha: s.commitSha,
      runs: group.map((r) => ({
        id: r.id,
        status: r.status,
        statusReason: r.statusReason,
        consensusIndex: r.consensusIndex,
        costUsd: Number(r.costUsd),
        toolCalls: r.toolCalls,
      })),
      status,
      report: report
        ? {
            id: report.id,
            status: report.status,
            finalOverall: report.finalOverall,
            percent: report.percent,
            letter: report.letter,
            lowConfidence: criteria.filter((c) => c.confidence === "low").length,
          }
        : null,
      flags: group.reduce((n, r) => n + (flagByRun.get(r.id) ?? 0), 0),
    };
  });

  const totalCost = runs.reduce((n, r) => n + Number(r.costUsd), 0);
  return { rows, totalCost };
}

/**
 * Leaderboard (spec §11.2): ranks reports for one rubric version using the pure scoring
 * module, with the spec's tie-break (highest-weight criterion first). Disqualified entries
 * are listed separately and get no rank.
 */
import { db } from "./db";
import { readSettings } from "./evaluation";
import { scoreInputs, type MergedCriterion, type ReportWarnings } from "./report";
import { RubricSchema, type Rubric } from "./rubric/schema";
import { compareForRanking, computeScore, type ScoreResult } from "./scoring";

export type LeaderboardEntry = {
  rank: number | null;
  tied: boolean;
  reportId: string;
  submissionId: string;
  name: string;
  team: string | null;
  status: string;
  overall: number | null;
  percent: number | null;
  letter: string | null;
  disqualified: boolean;
  flags: number;
  needsReview: boolean;
  lowConfidence: number;
  cells: Record<string, { score: number | null; norm: number | null; gate?: string; source?: string }>;
  result: ScoreResult;
};

export async function buildLeaderboard(evaluationId: string, rubricVersionId: string) {
  const [evaluation, version] = await Promise.all([
    db.evaluation.findUniqueOrThrow({ where: { id: evaluationId } }),
    db.rubricVersion.findUniqueOrThrow({ where: { id: rubricVersionId } }),
  ]);
  const rubric: Rubric = RubricSchema.parse(version.rubric);
  const settings = readSettings(evaluation.settings);
  const reports = await db.report.findMany({
    where: { rubricVersionId, submission: { evaluationId } },
    include: {
      submission: true,
      overrides: { orderBy: { createdAt: "asc" } },
      humanScores: { orderBy: { createdAt: "asc" } },
    },
  });
  const flagCounts = await db.integrityFlag.groupBy({
    by: ["runId"],
    where: { runId: { in: reports.flatMap((r) => r.runIds) } },
    _count: { _all: true },
  });

  const entries: LeaderboardEntry[] = reports.map((r) => {
    const merged = (r.criteria ?? []) as unknown as MergedCriterion[];
    const last = <T extends { criterionId: string }>(rows: T[]) => [
      ...new Map(rows.map((x) => [x.criterionId, x])).values(),
    ];
    const result = computeScore(rubric, scoreInputs(merged, last(r.overrides), last(r.humanScores), true), {
      treatInsufficientAsZero: settings.treatInsufficientAsZero,
    });
    const cells: LeaderboardEntry["cells"] = {};
    for (const o of result.criteria)
      cells[o.criterionId] = { score: o.score, norm: o.norm, gate: o.gate, source: o.source };
    const warnings = (r.warnings ?? {}) as ReportWarnings;
    return {
      rank: null,
      tied: false,
      reportId: r.id,
      submissionId: r.submissionId,
      name: r.submission.displayName,
      team: r.submission.teamName,
      status: r.status,
      overall: result.overall,
      percent: result.percent,
      letter: result.letter,
      disqualified: result.disqualified,
      flags: flagCounts.filter((f) => r.runIds.includes(f.runId)).reduce((n, f) => n + f._count._all, 0),
      needsReview: r.status === "needs_review" || (warnings.review?.length ?? 0) > 0,
      lowConfidence: merged.filter((m) => m.confidence === "low").length,
      cells,
      result,
    };
  });

  return { rubric, version: { id: version.id, version: version.version }, ...assignRanks(rubric, entries) };
}

/**
 * Standard competition ranking ("1, 1, 3"): sort by score with the spec tie-break; entries still
 * equal after every tie-break share a rank and are marked tied. DQs and unscored entries get no rank.
 */
export function assignRanks<
  E extends Pick<LeaderboardEntry, "rank" | "tied" | "disqualified" | "overall" | "result">,
>(rubric: Rubric, entries: E[]) {
  const ranked = entries
    .filter((e) => !e.disqualified && e.overall != null)
    .sort((a, b) => compareForRanking(rubric, a.result, b.result));
  ranked.forEach((e, i) => {
    const prev = ranked[i - 1];
    if (prev && compareForRanking(rubric, prev.result, e.result) === 0) {
      e.rank = prev.rank;
      e.tied = prev.tied = true;
    } else e.rank = i + 1;
  });
  return {
    ranked,
    unranked: entries.filter((e) => !e.disqualified && e.overall == null),
    disqualified: entries.filter((e) => e.disqualified),
  };
}

/** Rank movement between two rubric versions for submissions graded under both. */
export async function rankingDiff(evaluationId: string, fromVersionId: string, toVersionId: string) {
  const [a, b] = await Promise.all([
    buildLeaderboard(evaluationId, fromVersionId),
    buildLeaderboard(evaluationId, toVersionId),
  ]);
  const rankA = new Map(a.ranked.map((e) => [e.submissionId, e]));
  return b.ranked
    .filter((e) => rankA.has(e.submissionId))
    .map((e) => {
      const old = rankA.get(e.submissionId)!;
      return {
        submissionId: e.submissionId,
        name: e.name,
        fromRank: old.rank,
        toRank: e.rank,
        fromScore: old.overall,
        toScore: e.overall,
        delta: (old.rank ?? 0) - (e.rank ?? 0),
      };
    });
}

export function toCsv(rubric: Rubric, entries: LeaderboardEntry[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s)
      ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
      : s;
  };
  const header = [
    "rank",
    "tied",
    "name",
    "team",
    "status",
    "overall",
    "percent",
    "letter",
    "disqualified",
    "flags",
    ...rubric.criteria.map((c) => c.name),
  ];
  const lines = [header.map(esc).join(",")];
  for (const e of entries) {
    lines.push(
      [
        e.rank ?? "",
        e.tied ? "yes" : "",
        e.name,
        e.team ?? "",
        e.status,
        e.overall ?? "",
        e.percent ?? "",
        e.letter ?? "",
        e.disqualified ? "yes" : "",
        e.flags,
        ...rubric.criteria.map((c) => {
          const cell = e.cells[c.id];
          return c.type === "gate" ? (cell?.gate ?? "") : (cell?.score ?? "");
        }),
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * Everything the report page needs, loaded server-side (spec §11.2 "Report").
 * Shared by the app report page, the print route and public share links.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { codeToHtml } from "shiki";
import { db } from "./db";
import { readSettings } from "./evaluation";
import { redactSecrets } from "./ingest/scanners";
import { parseRepoUrl } from "./ingest/git";
import { resolveInside } from "./grading/fs-tools";
import type { MergedCriterion, ReportWarnings } from "./report";
import { scoreInputs } from "./report";
import { RubricSchema, type Criterion, type Rubric } from "./rubric/schema";
import { computeScore, type CriterionOutcome } from "./scoring";
import { storage } from "./storage";

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  swift: "swift",
  md: "markdown",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  vue: "vue",
  svelte: "svelte",
  dart: "dart",
  scala: "scala",
  lua: "lua",
  r: "r",
  dockerfile: "dockerfile",
  xml: "xml",
  env: "dotenv",
};

export function langFor(p: string): string {
  const base = p.split("/").pop()!.toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base.startsWith(".env")) return "dotenv";
  return LANG_BY_EXT[base.split(".").pop() ?? ""] ?? "text";
}

export type EvidenceView = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  quote: string;
  kind: "strength" | "issue";
  severity: "critical" | "major" | "minor" | null;
  verified: boolean;
  verifyReason: string | null;
  html: string | null;
  url: string | null;
};

export type CriterionView = {
  criterion: Criterion;
  merged: MergedCriterion | null;
  outcome: CriterionOutcome | null;
  aiOutcome: CriterionOutcome | null;
  band: { band: string; description: string } | null;
  evidence: EvidenceView[];
  overrides: {
    id: string;
    aiScore: number | null;
    newScore: number;
    reason: string;
    user: string;
    createdAt: string;
  }[];
  human: { score: number; note: string | null; user: string; createdAt: string } | null;
};

export type FlagView = {
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  path: string | null;
  line: number | null;
  description: string;
  sources: string[];
  url: string | null;
};

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

function blobUrl(
  sub: { sourceType: string; repoUrl: string | null; commitSha: string },
  p: string,
  s?: number,
  e?: number,
) {
  if (sub.sourceType !== "github" || !sub.repoUrl) return null;
  const base = parseRepoUrl(sub.repoUrl).url;
  return `${base}/blob/${sub.commitSha}/${p.split("/").map(encodeURIComponent).join("/")}${s ? `#L${s}${e && e !== s ? `-L${e}` : ""}` : ""}`;
}

async function snippet(root: string | null, rel: string, start: number, end: number): Promise<string | null> {
  if (!root) return null;
  try {
    const { abs } = await resolveInside(root, rel);
    const lines = (await readFile(abs, "utf8")).split(/\r?\n/);
    const lo = Math.max(1, start - 2);
    const hi = Math.min(lines.length, Math.max(start, end) + 2, lo + 60);
    const code = redactSecrets(lines.slice(lo - 1, hi).join("\n"));
    const html = await codeToHtml(code, {
      lang: langFor(rel),
      themes: { light: "github-light-high-contrast", dark: "github-dark" },
      defaultColor: false,
      transformers: [
        {
          line(node, line) {
            const n = lo + line - 1;
            node.properties["data-line"] = n;
            if (n >= start && n <= Math.max(start, end)) this.addClassToHast(node, "hl");
          },
        },
      ],
    }).catch(() => null);
    return html;
  } catch {
    return null;
  }
}

export async function loadReportView(
  reportId: string,
  opts: { share?: { hideComments: boolean; hideOverrides: boolean } } = {},
) {
  const report = await db.report.findUnique({
    where: { id: reportId },
    include: {
      submission: { include: { evaluation: true } },
      rubricVersion: true,
      approvedBy: { select: { name: true, email: true } },
      overrides: {
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      },
      humanScores: {
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      },
      comments: {
        include: { user: { select: { name: true, email: true, image: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!report) return null;
  const sub = report.submission;
  const rubric: Rubric = RubricSchema.parse(report.rubricVersion.rubric);
  const merged = (report.criteria ?? []) as unknown as MergedCriterion[];
  const settings = readSettings(sub.evaluation.settings);
  const runs = await db.run.findMany({
    where: { id: { in: report.runIds } },
    include: {
      criterionScores: { include: { evidence: true } },
      integrityFlags: true,
      executionResults: true,
      snapshot: true,
    },
    orderBy: { consensusIndex: "asc" },
  });
  const snapshot = runs.find((r) => r.snapshot)?.snapshot ?? null;
  const root = snapshot ? storage().localPath(snapshot.storageKey) : null;

  const latestBy = <T extends { criterionId: string }>(rows: T[]) => {
    const m = new Map<string, T>();
    for (const r of rows) m.set(r.criterionId, r);
    return [...m.values()];
  };
  const lastOverrides = latestBy(report.overrides);
  const lastHuman = latestBy(report.humanScores);
  const inputsFinal = scoreInputs(merged, lastOverrides, lastHuman, true);
  const final = computeScore(rubric, inputsFinal, {
    treatInsufficientAsZero: settings.treatInsufficientAsZero,
  });
  const ai = computeScore(rubric, scoreInputs(merged, [], lastHuman, false), {
    treatInsufficientAsZero: settings.treatInsufficientAsZero,
  });
  const who = (u: { name: string | null; email: string | null }) => u.name ?? u.email ?? "Someone";

  const criteria: CriterionView[] = [];
  for (const c of rubric.criteria) {
    const m = merged.find((x) => x.criterionId === c.id) ?? null;
    const rows = runs.flatMap((r) => r.criterionScores.filter((s) => s.criterionId === c.id));
    const evidence: EvidenceView[] = [];
    for (const e of rows.flatMap((s) => s.evidence)) {
      evidence.push({
        id: e.id,
        path: e.path,
        startLine: e.startLine,
        endLine: e.endLine,
        quote: redactSecrets(e.quote),
        kind: e.kind,
        severity: e.severity,
        verified: e.verified,
        verifyReason: e.verifyReason,
        html: e.verified ? await snippet(root, e.path, e.startLine, e.endLine) : null,
        url: blobUrl(sub, e.path, e.startLine, e.endLine),
      });
    }
    const outcome = final.criteria.find((o) => o.criterionId === c.id) ?? null;
    const score = outcome?.score ?? null;
    const span = rubric.scale.max - rubric.scale.min;
    const band =
      score != null && c.type === "scored" && c.anchors.length === 5
        ? c.anchors[Math.min(4, Math.floor(((score - rubric.scale.min) / span) * 5))]!
        : null;
    criteria.push({
      criterion: c,
      merged: m,
      outcome,
      aiOutcome: ai.criteria.find((o) => o.criterionId === c.id) ?? null,
      band,
      evidence,
      overrides: opts.share?.hideOverrides
        ? []
        : report.overrides
            .filter((o) => o.criterionId === c.id)
            .map((o) => ({
              id: o.id,
              aiScore: o.aiScore,
              newScore: o.newScore,
              reason: o.reason,
              user: who(o.user),
              createdAt: o.createdAt.toISOString(),
            })),
      human: (() => {
        const h = lastHuman.find((x) => x.criterionId === c.id);
        return h
          ? { score: h.score, note: h.note, user: who(h.user), createdAt: h.createdAt.toISOString() }
          : null;
      })(),
    });
  }

  // Flags: dedupe scanner + agent findings at the same location, keep the highest severity.
  const flagMap = new Map<string, FlagView>();
  for (const f of runs.flatMap((r) => r.integrityFlags)) {
    const key = `${f.category}|${f.path ?? ""}|${f.line ?? ""}`;
    const prev = flagMap.get(key);
    if (!prev) {
      flagMap.set(key, {
        severity: f.severity,
        category: f.category,
        path: f.path,
        line: f.line,
        description: redactSecrets(f.description),
        sources: [f.source],
        url: f.path ? blobUrl(sub, f.path, f.line ?? undefined) : null,
      });
    } else {
      if (!prev.sources.includes(f.source)) prev.sources.push(f.source);
      if (SEV_RANK[f.severity] < SEV_RANK[prev.severity]) prev.severity = f.severity;
      if (f.source === "agent" && f.description.length > prev.description.length)
        prev.description = redactSecrets(f.description);
    }
  }
  const flags = [...flagMap.values()].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);

  const failedGates = rubric.criteria.filter(
    (c) => c.type === "gate" && final.criteria.find((o) => o.criterionId === c.id)?.gate === "fail",
  );
  const confidences = merged.map((m) =>
    m.confidence === "high" ? 1 : m.confidence === "medium" ? 0.6 : 0.25,
  );
  const overallConfidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;
  const warnings = (report.warnings ?? { review: [], scoring: [] }) as ReportWarnings;
  const crossIssues = runs.flatMap(
    (r) => ((r.result ?? {}) as { crossCriterionIssues?: string[] }).crossCriterionIssues ?? [],
  );

  return {
    report: {
      id: report.id,
      status: report.status,
      summary: report.summary,
      recommendations: (report.recommendations ?? []) as {
        text: string;
        impact: "high" | "medium" | "low";
        effort: "high" | "medium" | "low";
      }[],
      coverage: report.coverage as {
        filesRead: number;
        totalSourceFiles: number;
        percent: number;
        readFiles: string[];
        searches: string[];
        toolCalls: number;
      },
      warnings,
      crossIssues: [...new Set(crossIssues)],
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
      approvedBy: report.approvedBy ? who(report.approvedBy) : null,
      approvedAt: report.approvedAt?.toISOString() ?? null,
      shareToken: report.shareToken,
      shareOptions: (report.shareOptions ?? { hideComments: true, hideOverrides: true }) as {
        hideComments: boolean;
        hideOverrides: boolean;
      },
    },
    submission: {
      id: sub.id,
      displayName: sub.displayName,
      teamName: sub.teamName,
      sourceType: sub.sourceType,
      repoUrl: sub.repoUrl,
      commitSha: sub.commitSha,
      treeUrl:
        sub.sourceType === "github" && sub.repoUrl
          ? `${parseRepoUrl(sub.repoUrl).url}/tree/${sub.commitSha}`
          : null,
    },
    evaluation: { id: sub.evaluationId, name: sub.evaluation.name },
    rubricVersion: { id: report.rubricVersionId, version: report.rubricVersion.version },
    rubric,
    final,
    ai,
    overrideCount: report.overrides.length,
    criteria,
    flags,
    failedGates,
    overallConfidence,
    consensusPasses: runs.length,
    verifierDisagreed: warnings.review.some((r) => /Verifier/.test(r)),
    execution: runs
      .flatMap((r) => r.executionResults)
      .map((e) => ({
        ...e,
        stdoutTail: redactSecrets(e.stdoutTail),
        stderrTail: redactSecrets(e.stderrTail),
      })),
    comments: opts.share?.hideComments
      ? []
      : report.comments.map((c) => ({
          id: c.id,
          criterionId: c.criterionId,
          body: c.body,
          user: who(c.user),
          createdAt: c.createdAt.toISOString(),
        })),
    usage: {
      costUsd: runs.reduce((n, r) => n + Number(r.costUsd), 0),
      tokensIn: runs.reduce((n, r) => n + r.tokensIn, 0),
      tokensOut: runs.reduce((n, r) => n + r.tokensOut, 0),
      model: runs[0]?.model ?? null,
    },
    snapshotPath: root ? path.basename(root) : null,
  };
}

export type ReportView = NonNullable<Awaited<ReturnType<typeof loadReportView>>>;

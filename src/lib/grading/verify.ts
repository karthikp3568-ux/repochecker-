/**
 * Deterministic verification (spec §5.4). Every evidence item must point at a real file and line
 * range in the snapshot, quote text that is actually there (±3 lines, whitespace-normalized), and
 * cite a file the agent actually read in this run (coverage logs, not self-report).
 */
import { readFile } from "node:fs/promises";
import type { Rubric } from "../rubric/schema";
import { redactSecrets } from "../ingest/scanners";
import { resolveInside, ToolError } from "./fs-tools";

export const LINE_TOLERANCE = 3;

export type EvidenceIn = { path: string; startLine: number; endLine: number; quote: string };
export type EvidenceCheck = { verified: boolean; reason: string | null };

const norm = (s: string) =>
  s
    .replace(/^\s*\d+\s{2}/gm, "") // tolerate copied line-number gutters
    .replace(/…\[redacted \d+ chars\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export async function verifyEvidence(
  root: string,
  items: EvidenceIn[],
  readPaths: Set<string>,
): Promise<EvidenceCheck[]> {
  const cache = new Map<string, string[] | null>();
  async function linesOf(rel: string) {
    if (!cache.has(rel)) {
      try {
        const { abs } = await resolveInside(root, rel);
        const text = await readFile(abs, "utf8");
        cache.set(rel, text.split(/\r?\n/));
      } catch {
        cache.set(rel, null);
      }
    }
    return cache.get(rel)!;
  }

  const out: EvidenceCheck[] = [];
  for (const e of items) {
    let rel: string;
    try {
      rel = (await resolveInside(root, e.path)).rel;
    } catch (err) {
      out.push({
        verified: false,
        reason: err instanceof ToolError ? `File not found: ${e.path}` : "Invalid path",
      });
      continue;
    }
    const lines = await linesOf(rel);
    if (!lines) {
      out.push({ verified: false, reason: `File not readable: ${rel}` });
      continue;
    }
    const total = lines.length - (lines.at(-1) === "" ? 1 : 0);
    if (!(e.startLine >= 1 && e.endLine >= e.startLine && e.startLine <= total)) {
      out.push({
        verified: false,
        reason: `Line range ${e.startLine}–${e.endLine} is outside the file (${total} lines)`,
      });
      continue;
    }
    if (!readPaths.has(rel)) {
      out.push({ verified: false, reason: "The agent never read this file in this run" });
      continue;
    }
    const q = norm(e.quote);
    if (q.length < 3) {
      out.push({ verified: false, reason: "Quote is empty or too short" });
      continue;
    }
    const lo = Math.max(0, e.startLine - 1 - LINE_TOLERANCE);
    const hi = Math.min(total, e.endLine + LINE_TOLERANCE);
    const window = lines.slice(lo, hi).join("\n");
    const ok = norm(window).includes(q) || norm(redactSecrets(window)).includes(q);
    out.push(
      ok
        ? { verified: true, reason: null }
        : { verified: false, reason: "Quote not found at the cited lines" },
    );
  }
  return out;
}

export type RecordedScore = {
  criterionId: string;
  status: "scored" | "insufficient_evidence" | "gate_pass" | "gate_fail";
  score: number | null;
};

/** Completeness: every AI criterion recorded, scores within the scale, gates pass/fail. */
export function checkCompleteness(rubric: Rubric, scores: RecordedScore[]) {
  const byId = new Map(scores.map((s) => [s.criterionId, s]));
  const missing: string[] = [];
  const problems: string[] = [];
  for (const c of rubric.criteria) {
    if (c.scorer !== "ai") continue;
    const s = byId.get(c.id);
    if (!s) {
      missing.push(c.id);
      continue;
    }
    if (c.type === "gate") {
      if (s.status !== "gate_pass" && s.status !== "gate_fail" && s.status !== "insufficient_evidence") {
        problems.push(`Gate “${c.name}” must be recorded as gate_pass or gate_fail.`);
      }
    } else if (s.status === "scored") {
      const max = c.type === "bonus" ? (c.bonusMax ?? 0) : rubric.scale.max;
      const min = c.type === "bonus" ? 0 : rubric.scale.min;
      if (s.score == null || s.score < min || s.score > max)
        problems.push(`“${c.name}” score ${s.score} is outside ${min}–${max}.`);
    } else if (s.status !== "insufficient_evidence") {
      problems.push(`“${c.name}” has invalid status ${s.status}.`);
    }
  }
  return { complete: missing.length === 0 && problems.length === 0, missing, problems };
}

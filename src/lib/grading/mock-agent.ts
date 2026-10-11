/**
 * Mock grading driver (LLM_MODE=mock). A deterministic "agent" that explores the real snapshot
 * through the same harness tools as Claude, records scores with real (verifiable) quotes, flags
 * scanner findings, and finishes — so the whole pipeline runs end-to-end at zero API cost.
 * One deliberately fabricated evidence item per run exercises evidence discarding.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RepoFacts } from "../ingest/index";
import { isTestPath } from "../ingest/index";
import { walkRepo } from "../ingest/walk";
import { ZERO_USAGE } from "../llm/pricing";
import type { Criterion } from "../rubric/schema";
import type { AgentResult } from "./agent";
import { MOCK_MODEL } from "../llm/mock";
import { CancelledError, type GradingSession, type RecordScoreInput } from "./session";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Heuristic 0..1 quality for a criterion, from deterministic repo facts and its wording. */
function signal(c: Criterion, facts: RepoFacts, flags: number, sha: string): number {
  // Classify by the criterion's name; fall back to its description only if the name says nothing.
  const KNOWN =
    /integrity|original|copy|plagiar|honest|claim|test|doc|readme|secur|secret|work|function|correct|solve|run|quality|clean|readab/;
  const text = (KNOWN.test(c.name.toLowerCase()) ? c.name : `${c.name} ${c.description}`).toLowerCase();
  const jitter = (hash(`${c.id}|${sha}`) - 0.5) * 0.16;
  if (/quality|clean|readab/.test(text)) {
    const avgLines = facts.size.sourceFiles ? facts.size.totalLoc / facts.size.sourceFiles : 0;
    return clamp01(0.75 - (avgLines > 250 ? 0.2 : 0) - (facts.tests.files === 0 ? 0.15 : 0) + jitter);
  }
  // Integrity wording often mentions README claims, so it is matched before docs.
  if (/integrity|original|copy|plagiar|honest|claim/.test(text)) return clamp01(0.8 - flags * 0.25 + jitter);
  if (/test/.test(text))
    return clamp01(
      Math.min(1, facts.tests.testToSourceLocRatio * 1.4) * 0.85 + (facts.tests.files > 0 ? 0.1 : 0) + jitter,
    );
  if (/doc|readme/.test(text))
    return clamp01(
      Math.min(1, facts.docs.readmeWords / 600) * 0.85 + (facts.docs.license ? 0.1 : 0) + jitter,
    );
  if (/secur|secret/.test(text)) return clamp01(0.75 - facts.secretFindings.length * 0.25 + jitter);
  if (/work|function|correct|solve|run/.test(text)) {
    return clamp01(
      0.45 +
        (facts.entryPoints.length ? 0.15 : 0) +
        Math.min(0.2, facts.tests.files * 0.03) +
        (facts.ci.length ? 0.08 : 0) -
        flags * 0.15 +
        jitter,
    );
  }
  const avgFile = facts.size.sourceFiles ? facts.size.totalLoc / facts.size.sourceFiles : 0;
  const sizePenalty = avgFile > 400 ? 0.2 : avgFile > 250 ? 0.1 : 0;
  return clamp01(0.62 - sizePenalty + (facts.tests.files ? 0.08 : 0) + jitter);
}

type Read = { rel: string; lines: string[] };

export async function runMockAgent(
  session: GradingSession,
  input: { root: string; facts: RepoFacts; isCancelled: () => Promise<boolean>; stepDelayMs?: number },
): Promise<AgentResult> {
  const delay = input.stepDelayMs ?? 120;
  const step = async () => {
    await pause(delay);
    if (await input.isCancelled()) throw new CancelledError();
  };
  const { facts, root } = input;
  const sha = facts.repo.commitSha;

  await session.call("list_dir", { path: ".", depth: 2 });
  await step();

  // Pick the largest source files plus README and a test file.
  const walked = await walkRepo(root, { maxFiles: 50_000, maxBytes: 2e9 });
  const source = walked.files.filter((f) => f.kind === "source" && f.lines > 0);
  const code = source.filter((f) => !/\.(md|json|ya?ml|toml|lock|txt)$/i.test(f.path) && !isTestPath(f.path));
  const picks = new Set<string>();
  code
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 5)
    .forEach((f) => picks.add(f.path));
  const test = source.find((f) => isTestPath(f.path));
  if (test) picks.add(test.path);
  const readme = source.find((f) => /^readme/i.test(f.path));
  if (readme) picks.add(readme.path);

  const reads: Read[] = [];
  for (const p of picks) {
    const res = await session.call("read_file", { path: p, startLine: 1, endLine: 160 });
    if (!res.startsWith("Error")) {
      const text = await readFile(path.join(root, p), "utf8").catch(() => "");
      reads.push({ rel: p, lines: text.split(/\r?\n/).slice(0, 160) });
    }
    await step();
  }

  // Integrity checks driven by deterministic scanners (never by repo instructions).
  for (const f of facts.injectionFindings.slice(0, 5)) {
    await session.call("read_file", {
      path: f.path,
      startLine: Math.max(1, f.line - 2),
      endLine: f.line + 2,
    });
    await session.call("record_flag", {
      severity: "high",
      category: "prompt_injection",
      path: f.path,
      line: f.line,
      description: `Text aimed at AI graders was found and ignored: “${f.snippet.slice(0, 120)}”. It did not affect any score.`,
    });
    await step();
  }
  for (const s of facts.secretFindings.slice(0, 5)) {
    await session.call("record_flag", {
      severity: s.kind === "committed_env_file" || s.kind === "private_key" ? "high" : "medium",
      category: "secret",
      path: s.path,
      line: s.line,
      description: `Possible committed secret (${s.kind}): ${s.redacted}. Rotate it and remove it from history.`,
    });
  }
  const fake = await session.call("search_code", {
    pattern: "(accuracy|precision|f1|score)\\s*[:=]\\s*0\\.9\\d+|return\\s+0\\.9\\d+",
    maxResults: 10,
  });
  const fakeHit = fake.match(/^(.+?):(\d+): (.*)$/m);
  if (fakeHit) {
    await session.call("read_file", {
      path: fakeHit[1],
      startLine: Math.max(1, Number(fakeHit[2]) - 3),
      endLine: Number(fakeHit[2]) + 3,
    });
    await session.call("record_flag", {
      severity: "high",
      category: "fake_results",
      path: fakeHit[1],
      line: Number(fakeHit[2]),
      description: `A metric appears to be hardcoded rather than computed: “${fakeHit[3]!.slice(0, 100)}”.`,
    });
  }
  await step();

  // README claims: look for each claim's key term in the source.
  const missingClaims: string[] = [];
  for (const claim of facts.readmeClaims.slice(0, 8)) {
    const term = claim
      .toLowerCase()
      .match(/[a-z][a-z0-9_-]{4,}/g)
      ?.find(
        (w) =>
          !/^(support|supports|allows|enable|enables|provides|feature|features|users|their|which|using|with|from|that|these)$/.test(
            w,
          ),
      );
    if (!term) continue;
    const r = await session.call("search_code", { pattern: term, maxResults: 20 });
    const codeHits = r.split("\n").filter((l) => /:\d+:/.test(l) && !/\.(md|markdown|txt|rst):\d+:/i.test(l));
    if (codeHits.length === 0) missingClaims.push(claim);
  }
  if (missingClaims.length) {
    await session.call("record_flag", {
      severity: "medium",
      category: "readme_claims",
      path: readme?.path ?? null,
      line: null,
      description: `README claims not found in the code: ${missingClaims.map((c) => `“${c}”`).join("; ")}.`,
    });
  }
  await session.call("git_log", { limit: 10 });
  await step();

  // Score every AI criterion with real quotes from the files read.
  const flagCount = session.flags.filter((f) => f.category !== "secret").length;
  const { scale } = session.rubric;
  const quotable = reads.flatMap((r) =>
    r.lines
      .map((text, i) => ({ rel: r.rel, line: i + 1, text: text.trim() }))
      .filter((l) => l.text.length >= 12 && l.text.length <= 160 && !/^[#/*\-\s]*$/.test(l.text)),
  );
  let first = true;
  for (const c of session.rubric.criteria.filter((x) => x.scorer === "ai")) {
    const q = signal(c, facts, flagCount, sha);
    const offset = Math.floor(hash(`${c.id}:${sha}:q`) * Math.max(1, quotable.length - 3));
    const ev = quotable.slice(offset, offset + 3);
    const evidence: RecordScoreInput["evidence"] = ev.map((l, i) => ({
      path: l.rel,
      startLine: l.line,
      endLine: l.line,
      quote: l.text,
      kind: i === 0 && q < 0.5 ? ("issue" as const) : ("strength" as const),
      severity: i === 0 && q < 0.5 ? ("major" as const) : null,
    }));
    if (first && ev[0]) {
      // Deliberately unverifiable: the verifier must discard this.
      evidence.push({
        path: ev[0].rel,
        startLine: ev[0].line,
        endLine: ev[0].line,
        quote: "function thisQuoteDoesNotExist() {}",
        kind: "strength",
        severity: null,
      });
      first = false;
    }
    const base = {
      criterionId: c.id,
      confidence:
        ev.length >= 2 ? (q > 0.3 && q < 0.85 ? ("medium" as const) : ("high" as const)) : ("low" as const),
      evidence,
      improvement: `To raise “${c.name}”, address: ${c.lookFor[0] ?? c.description}`.slice(0, 300),
    };
    if (c.type === "gate") {
      await session.call("record_score", {
        ...base,
        status: q >= 0.35 ? "gate_pass" : "gate_fail",
        score: null,
        rationale: `Mock grader: the gate “${c.name}” ${q >= 0.35 ? "appears satisfied" : "does not appear satisfied"} based on the files read.`,
      });
    } else if (c.type === "bonus") {
      const max = c.bonusMax ?? 1;
      await session.call("record_score", {
        ...base,
        status: "scored",
        score: Math.round(q * max * 10) / 10,
        rationale: `Mock grader: partial bonus based on the signals observed (${Math.round(q * 100)}%).`,
      });
    } else if (ev.length === 0) {
      await session.call("record_score", {
        ...base,
        status: "insufficient_evidence",
        score: null,
        rationale: "Mock grader: no readable source to cite.",
      });
    } else {
      const score = Math.round((scale.min + q * (scale.max - scale.min)) * 2) / 2;
      const band = c.anchors[Math.min(4, Math.floor(q * 5))];
      await session.call("record_score", {
        ...base,
        status: "scored",
        score,
        rationale: `Mock grader: the code best matches the “${band?.band ?? "middle"}” band (${band?.description ?? ""}). Cited lines show the relevant signals.`,
      });
    }
    await step();
  }

  const weakest = [...session.scores.values()]
    .filter((s) => s.score != null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 3);
  await session.call("finish", {
    summary: `Mock grading of ${facts.repo.url}: ${facts.size.sourceFiles} source files, ${facts.tests.files} test files. ${session.flags.length ? `${session.flags.length} integrity flag(s) raised.` : "No integrity concerns found."} Scores are deterministic placeholders from mock mode.`,
    recommendations: weakest.map((s, i) => ({
      text: s.improvement,
      impact: i === 0 ? ("high" as const) : ("medium" as const),
      effort: "medium" as const,
    })),
    unassessed: [],
  });
  return { usage: ZERO_USAGE, model: MOCK_MODEL, refusal: null, nudges: 0, unfinished: !session.finished };
}

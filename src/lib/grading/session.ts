/**
 * The grading harness (spec §5.2). Owns tool execution, budget, coverage logging (FileAccess rows
 * are the coverage source of truth), score/flag recording and live events. Both the live Claude
 * driver and the mock driver go through `call()`, so behaviour is identical in both modes.
 */
import { z } from "zod";
import { db } from "../db";
import { emitRunEvent } from "../events";
import type { Rubric } from "../rubric/schema";
import { BUDGET_EXHAUSTED, BUDGET_NOTE } from "../llm/prompts/grader";
import { gitLog, listDir, readFileLines, searchCode, ToolError } from "./fs-tools";

const EvidenceSchema = z.object({
  path: z.string().describe("Repo-relative file path you read with read_file"),
  startLine: z.number().int().describe("First line of the quoted range (1-based)"),
  endLine: z.number().int().describe("Last line of the quoted range"),
  quote: z.string().describe("Verbatim text copied from those lines, without line numbers"),
  kind: z.enum(["strength", "issue"]),
  severity: z.enum(["critical", "major", "minor"]).nullable().optional().describe("For issues only"),
});

export const ToolInputs = {
  list_dir: z.object({
    path: z.string().default(".").describe("Directory, repo-relative"),
    depth: z.number().int().min(1).max(3).default(1),
  }),
  read_file: z.object({
    path: z.string(),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  }),
  search_code: z.object({
    pattern: z.string().describe("Regex (ripgrep syntax), smart-case"),
    glob: z.string().optional().describe("Optional file glob, e.g. **/*.py"),
    maxResults: z.number().int().min(1).max(50).default(30),
  }),
  git_log: z.object({
    limit: z.number().int().min(1).max(50).default(20),
    path: z.string().optional(),
  }),
  run_command: z.object({ command: z.string().max(500) }),
  record_score: z.object({
    criterionId: z.string(),
    status: z.enum(["scored", "insufficient_evidence", "gate_pass", "gate_fail"]),
    score: z
      .number()
      .nullable()
      .optional()
      .describe("On the rubric scale (bonus: 0..bonus max). Omit for gates/insufficient."),
    confidence: z.enum(["high", "medium", "low"]),
    rationale: z.string(),
    evidence: z.array(EvidenceSchema).max(8),
    improvement: z.string(),
  }),
  record_flag: z.object({
    severity: z.enum(["critical", "high", "medium", "low"]),
    category: z
      .string()
      .describe("e.g. prompt_injection, plagiarism, fake_results, readme_claims, secret, git_history"),
    path: z.string().nullable().optional(),
    line: z.number().int().nullable().optional(),
    description: z.string(),
  }),
  finish: z.object({
    summary: z.string(),
    recommendations: z
      .array(
        z.object({
          text: z.string(),
          impact: z.enum(["high", "medium", "low"]),
          effort: z.enum(["high", "medium", "low"]),
        }),
      )
      .max(8),
    unassessed: z.array(z.string()).default([]),
  }),
} as const;

export type ToolName = keyof typeof ToolInputs;
export type RecordScoreInput = z.infer<(typeof ToolInputs)["record_score"]>;
export type FlagInput = z.infer<(typeof ToolInputs)["record_flag"]>;
export type FinishInput = z.infer<(typeof ToolInputs)["finish"]>;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_dir:
    "List a directory of the repository with line counts (depth 1–3). Vendored/build dirs are marked excluded.",
  read_file:
    "Read a file with numbered lines (max 600 lines per call). Use startLine/endLine for ranges. Secrets are redacted.",
  search_code:
    "Regex search across source files (ripgrep). Returns path:line: text. Excludes vendored/build dirs.",
  git_log: "Show recent commits (hash, date, author, message, change stats), optionally for one path.",
  run_command:
    "Run a command inside the offline execution sandbox (120 s timeout, no network). Only in execution mode.",
  record_score:
    "Record (or revise) the score for one criterion with verbatim, line-cited evidence from files you read. Call again to revise.",
  record_flag:
    "Record an integrity flag (prompt injection, plagiarism, faked results, unsupported README claims, secrets, git history).",
  finish:
    "End the run with a summary, prioritized recommendations and any unassessed criteria. Call once, last.",
};

const EXPLORATION = new Set<ToolName>(["list_dir", "read_file", "search_code", "git_log", "run_command"]);

export class CancelledError extends Error {
  constructor() {
    super("Run cancelled");
    this.name = "CancelledError";
  }
}

export type SessionOptions = {
  runId: string;
  root: string;
  rubric: Rubric;
  budget: number;
  runCommand?: (command: string) => Promise<string>;
  /** Returns true when the run has been cancelled (checked periodically). */
  isCancelled?: () => Promise<boolean>;
};

export class GradingSession {
  toolCalls = 0;
  readPaths = new Set<string>();
  searches: string[] = [];
  scores = new Map<string, RecordScoreInput>();
  flags: FlagInput[] = [];
  finished: FinishInput | null = null;
  budgetExhausted = false;
  private noted = false;

  constructor(private readonly opts: SessionOptions) {}

  get rubric() {
    return this.opts.rubric;
  }
  get budget() {
    return this.opts.budget;
  }

  /** AI-scored criteria with no record yet. */
  missingCriteria() {
    return this.opts.rubric.criteria.filter((c) => c.scorer === "ai" && !this.scores.has(c.id));
  }

  /** Hard cap: budget plus room to record every criterion and finish. */
  get hardCap() {
    return this.opts.budget + this.opts.rubric.criteria.length * 2 + 6;
  }

  async call(name: ToolName, rawInput: unknown): Promise<string> {
    if (this.toolCalls % 5 === 0 && (await this.opts.isCancelled?.())) throw new CancelledError();
    this.toolCalls++;
    if (this.toolCalls > this.hardCap) {
      this.budgetExhausted = true;
      throw new BudgetExceededError();
    }
    const parsed = ToolInputs[name].safeParse(rawInput);
    if (!parsed.success) return `Error: invalid input for ${name}: ${z.prettifyError(parsed.error)}`;

    if (EXPLORATION.has(name) && this.toolCalls > this.opts.budget) {
      this.budgetExhausted = true;
      await this.event("warning", "Tool budget exhausted", { tool: name });
      return BUDGET_EXHAUSTED;
    }
    try {
      const result = await this.dispatch(name, parsed.data as never);
      if (EXPLORATION.has(name) && this.toolCalls >= Math.ceil(this.opts.budget * 0.8)) {
        if (!this.noted) await this.event("note", "80% of tool budget used — asked the agent to wrap up", {});
        this.noted = true;
        return result + BUDGET_NOTE;
      }
      return result;
    } catch (err) {
      if (err instanceof ToolError) {
        await this.event("tool", `${name} failed: ${err.message}`, { tool: name, error: err.message });
        return `Error: ${err.message}`;
      }
      throw err;
    }
  }

  private async dispatch(name: ToolName, input: never): Promise<string> {
    switch (name) {
      case "list_dir": {
        const i = input as z.infer<(typeof ToolInputs)["list_dir"]>;
        const out = await listDir(this.opts.root, i.path, i.depth);
        await this.event("tool", `Listed ${i.path === "." || !i.path ? "repository root" : i.path}`, {
          tool: name,
          path: i.path,
        });
        return out;
      }
      case "read_file": {
        const i = input as z.infer<(typeof ToolInputs)["read_file"]>;
        const r = await readFileLines(this.opts.root, i.path, i.startLine, i.endLine);
        this.readPaths.add(r.rel);
        await db.fileAccess.create({
          data: {
            runId: this.opts.runId,
            path: r.rel,
            startLine: r.startLine,
            endLine: r.endLine,
            kind: "read",
          },
        });
        await this.event("tool", `Read ${r.rel} (lines ${r.startLine}–${r.endLine})`, {
          tool: name,
          path: r.rel,
          startLine: r.startLine,
          endLine: r.endLine,
        });
        return r.text;
      }
      case "search_code": {
        const i = input as z.infer<(typeof ToolInputs)["search_code"]>;
        const r = await searchCode(this.opts.root, i.pattern, i.glob, i.maxResults);
        this.searches.push(i.pattern);
        await db.fileAccess.create({
          data: {
            runId: this.opts.runId,
            path: `search:${i.pattern}${i.glob ? ` in ${i.glob}` : ""}`.slice(0, 500),
            kind: "search",
          },
        });
        await this.event(
          "tool",
          `Searched ${i.pattern}${i.glob ? ` in ${i.glob}` : ""} (${r.hits.length} hits)`,
          { tool: name, pattern: i.pattern },
        );
        return r.text;
      }
      case "git_log": {
        const i = input as z.infer<(typeof ToolInputs)["git_log"]>;
        const out = await gitLog(this.opts.root, i.limit, i.path);
        await this.event("tool", `Viewed git history${i.path ? ` of ${i.path}` : ""}`, { tool: name });
        return out;
      }
      case "run_command": {
        const i = input as z.infer<(typeof ToolInputs)["run_command"]>;
        if (!this.opts.runCommand) return "Error: run_command is only available in execution mode.";
        await this.event("tool", `Ran ${i.command.slice(0, 80)}`, { tool: name, command: i.command });
        return this.opts.runCommand(i.command);
      }
      case "record_score":
        return this.recordScore(input as RecordScoreInput);
      case "record_flag": {
        const i = input as FlagInput;
        this.flags.push(i);
        await db.integrityFlag.create({
          data: {
            runId: this.opts.runId,
            severity: i.severity,
            category: i.category.slice(0, 60),
            path: i.path ?? null,
            line: i.line ?? null,
            description: i.description.slice(0, 2000),
            source: "agent",
          },
        });
        await this.event(
          "warning",
          `Flagged ${i.category} (${i.severity})${i.path ? ` at ${i.path}${i.line ? `:${i.line}` : ""}` : ""}`,
          { tool: name, ...i },
        );
        return "Flag recorded.";
      }
      case "finish": {
        const i = input as FinishInput;
        const missing = this.missingCriteria();
        if (missing.length) {
          return `Not finished: record these criteria first (use insufficient_evidence if needed): ${missing.map((c) => `${c.id} (${c.name})`).join(", ")}`;
        }
        this.finished = i;
        await this.event("note", "Agent finished grading", { tool: name });
        return "Finished. Thank you.";
      }
    }
  }

  private async recordScore(i: RecordScoreInput): Promise<string> {
    const c = this.opts.rubric.criteria.find((x) => x.id === i.criterionId);
    if (!c)
      return `Error: unknown criterionId ${i.criterionId}. Valid ids: ${this.opts.rubric.criteria.map((x) => x.id).join(", ")}`;
    if (c.scorer !== "ai") return `Error: ${c.name} is scored by a human; do not record it.`;
    const { scale } = this.opts.rubric;
    if (c.type === "gate" && i.status === "scored")
      return `Error: ${c.name} is a gate; use gate_pass or gate_fail.`;
    if (c.type !== "gate" && (i.status === "gate_pass" || i.status === "gate_fail"))
      return `Error: ${c.name} is not a gate; use scored.`;
    if (i.status === "scored") {
      const [min, max] = c.type === "bonus" ? [0, c.bonusMax ?? 0] : [scale.min, scale.max];
      if (i.score == null || i.score < min || i.score > max)
        return `Error: score for ${c.name} must be between ${min} and ${max}.`;
    }
    const score = i.status === "scored" ? i.score! : null;
    this.scores.set(c.id, { ...i, score });

    await db.$transaction(async (tx) => {
      const row = await tx.criterionScore.upsert({
        where: { runId_criterionId: { runId: this.opts.runId, criterionId: c.id } },
        update: {
          status: i.status,
          score,
          confidence: i.confidence,
          rationale: i.rationale,
          improvement: i.improvement,
        },
        create: {
          runId: this.opts.runId,
          criterionId: c.id,
          status: i.status,
          score,
          confidence: i.confidence,
          rationale: i.rationale,
          improvement: i.improvement,
        },
      });
      await tx.evidence.deleteMany({ where: { criterionScoreId: row.id } });
      if (i.evidence.length) {
        await tx.evidence.createMany({
          data: i.evidence.map((e) => ({
            criterionScoreId: row.id,
            path: e.path.replace(/\\/g, "/").replace(/^\.?\//, ""),
            startLine: e.startLine,
            endLine: Math.max(e.startLine, e.endLine),
            quote: e.quote.slice(0, 4000),
            kind: e.kind,
            severity: e.kind === "issue" ? (e.severity ?? "minor") : null,
            verified: false,
          })),
        });
      }
    });
    const label =
      i.status === "scored"
        ? `Scored ${c.name}: ${score}/${c.type === "bonus" ? c.bonusMax : scale.max}`
        : i.status === "insufficient_evidence"
          ? `${c.name}: insufficient evidence`
          : `${c.name}: gate ${i.status === "gate_pass" ? "passed" : "failed"}`;
    await this.event("tool", label, {
      tool: "record_score",
      criterionId: c.id,
      status: i.status,
      score,
      confidence: i.confidence,
    });
    const remaining = this.missingCriteria();
    return `Recorded ${c.name}.${remaining.length ? ` Still to record: ${remaining.map((x) => x.name).join(", ")}.` : " All criteria recorded; call finish when done."}`;
  }

  async event(
    type: "stage" | "tool" | "note" | "warning" | "error",
    label: string,
    payload: Record<string, unknown>,
  ) {
    await emitRunEvent({
      runId: this.opts.runId,
      type,
      label,
      payload: { ...payload, toolCalls: this.toolCalls },
    });
  }
}

export class BudgetExceededError extends Error {
  constructor() {
    super("Tool budget hard cap exceeded");
    this.name = "BudgetExceededError";
  }
}

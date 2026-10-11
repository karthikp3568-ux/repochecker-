/**
 * Run pipeline + state machine (spec §3.1, §5.1, §14):
 * QUEUED → FETCHING → INDEXING → [EXECUTING] → GRADING → VERIFYING → SCORING → COMPLETED | NEEDS_REVIEW
 * Stages are idempotent; `completedStage` lets a retry resume after the last finished stage.
 */
import type { Run, RunStatus } from "@/generated/prisma/client";
import { DEPTH_PRESETS, type Depth } from "@/lib/config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { PipelineError } from "@/lib/errors";
import { emitRunEvent } from "@/lib/events";
import { readSettings } from "@/lib/evaluation";
import { runLiveAgent } from "@/lib/grading/agent";
import { runMockAgent } from "@/lib/grading/mock-agent";
import { GradingSession } from "@/lib/grading/session";
import { runVerifier, verifierNeedsReview } from "@/lib/grading/verifier";
import { checkCompleteness, verifyEvidence } from "@/lib/grading/verify";
import { fetchSnapshot, indexSnapshot } from "@/lib/ingest/fetch";
import type { RepoFacts } from "@/lib/ingest/index";
import { addUsage, costUsd, ZERO_USAGE, type Usage } from "@/lib/llm/pricing";
import { graderSystemPrompt, graderUserMessage, type ExecutionSummary } from "@/lib/llm/prompts/grader";
import { LlmRefusalError } from "@/lib/llm/types";
import { buildReportForGroup } from "@/lib/report";
import { ContextSchema, RubricSchema } from "@/lib/rubric/schema";
import { executionAllowed } from "@/lib/sandbox";

const STAGES = ["FETCHING", "INDEXING", "EXECUTING", "GRADING", "VERIFYING", "SCORING"] as const;
type Stage = (typeof STAGES)[number];
const TERMINAL: RunStatus[] = ["COMPLETED", "NEEDS_REVIEW", "FAILED", "CANCELLED"];
export const RUN_TIMEOUT_MS = 30 * 60 * 1000;

const STAGE_LABEL: Record<Stage, string> = {
  FETCHING: "Fetching repository",
  INDEXING: "Indexing files and scanning for secrets",
  EXECUTING: "Running build and tests in the sandbox",
  GRADING: "Grading with the AI agent",
  VERIFYING: "Verifying evidence",
  SCORING: "Computing final scores",
};

const done = (run: Pick<Run, "completedStage">, stage: Stage) =>
  run.completedStage != null && STAGES.indexOf(run.completedStage as Stage) >= STAGES.indexOf(stage);

export class RunContext {
  usage: Usage = ZERO_USAGE;
  model: string;
  reviewReasons: string[] = [];
  /** Tokens already on the run from earlier attempts. */
  private readonly base: Usage;
  constructor(public run: Run) {
    this.model = run.model;
    this.base = {
      input: run.tokensIn,
      output: run.tokensOut,
      cacheRead: run.cacheRead,
      cacheWrite: run.cacheWrite,
    };
  }

  async isCancelled() {
    const r = await db.run.findUnique({ where: { id: this.run.id }, select: { status: true } });
    return r?.status === "CANCELLED";
  }

  async stage(stage: Stage) {
    if (await this.isCancelled()) throw new PipelineError("CANCELLED", "Run cancelled");
    this.run = await db.run.update({
      where: { id: this.run.id },
      data: { status: stage, startedAt: this.run.startedAt ?? new Date() },
    });
    await emitRunEvent({ runId: this.run.id, type: "stage", label: STAGE_LABEL[stage], payload: { stage } });
  }

  async complete(stage: Stage) {
    this.run = await db.run.update({ where: { id: this.run.id }, data: { completedStage: stage } });
  }

  async addUsage(u: Usage, model?: string) {
    this.usage = addUsage(this.usage, u);
    if (model) this.model = model;
    await this.saveUsage();
  }

  async saveUsage(extra: { toolCalls?: number } = {}) {
    const t = addUsage(this.base, this.usage);
    this.run = await db.run.update({
      where: { id: this.run.id },
      data: {
        tokensIn: t.input,
        tokensOut: t.output,
        cacheRead: t.cacheRead,
        cacheWrite: t.cacheWrite,
        costUsd: costUsd(this.model, t),
        model: this.model,
        ...(extra.toolCalls != null ? { toolCalls: extra.toolCalls } : {}),
      },
    });
  }
}

export async function processRun(runId: string): Promise<void> {
  const initial = await db.run.findUnique({ where: { id: runId } });
  if (!initial || TERMINAL.includes(initial.status)) return;

  const submission = await db.submission.findUniqueOrThrow({
    where: { id: initial.submissionId },
    include: { evaluation: true },
  });
  const evaluation = submission.evaluation;
  const version = await db.rubricVersion.findUniqueOrThrow({ where: { id: initial.rubricVersionId } });
  const rubric = RubricSchema.parse(version.rubric);
  const settings = readSettings(evaluation.settings);
  const deadline = settings.deadlineMode ? evaluation.deadline : null;
  const depth = (initial.depth in DEPTH_PRESETS ? initial.depth : "standard") as Depth;
  const preset = DEPTH_PRESETS[depth];
  const ctx = new RunContext(initial);
  const abort = new AbortController();
  const timer = setTimeout(
    () => abort.abort(new PipelineError("TIMEOUT", "Run exceeded 30 minutes")),
    RUN_TIMEOUT_MS,
  );

  try {
    // FETCHING + INDEXING are cheap and cached, so they always run (they re-hydrate the snapshot path).
    await ctx.stage("FETCHING");
    const fetched = await fetchSnapshot(submission, { deadline });
    await ctx.complete("FETCHING");

    await ctx.stage("INDEXING");
    const fresh = await db.submission.findUniqueOrThrow({ where: { id: submission.id } });
    const { snapshot, facts } = await indexSnapshot(fresh, fetched, { deadline });
    await db.run.update({ where: { id: runId }, data: { snapshotId: snapshot.id } });
    if (!done(ctx.run, "INDEXING")) await scannerFlags(runId, facts);
    await emitRunEvent({
      runId,
      type: "note",
      label: `Indexed ${facts.size.sourceFiles} source files (${facts.size.totalLoc.toLocaleString()} lines)${fetched.reused ? " — reused cached snapshot" : ""}`,
      payload: { reused: fetched.reused },
    });
    await ctx.complete("INDEXING");

    // EXECUTING (optional; Phase 6). Failures degrade to static mode.
    let execution: ExecutionSummary[] | null = null;
    const runExec = settings.execution && executionAllowed();
    if (runExec) {
      await ctx.stage("EXECUTING");
      try {
        const { runExecution } = await import("@/lib/sandbox/docker");
        execution = await runExecution({ runId, root: fetched.dir, facts, signal: abort.signal });
      } catch (err) {
        await emitRunEvent({
          runId,
          type: "warning",
          label: "Sandbox failed — continuing in static mode",
          payload: { code: "SANDBOX_FAILED", message: (err as Error).message },
        });
        ctx.reviewReasons.push("Execution sandbox failed (SANDBOX_FAILED); graded statically.");
        execution = null;
      }
      await ctx.complete("EXECUTING");
    }

    // GRADING
    if (!done(ctx.run, "GRADING")) {
      await ctx.stage("GRADING");
      await resetGrading(runId);
      const session = new GradingSession({
        runId,
        root: fetched.dir,
        rubric,
        budget: preset.toolBudget,
        isCancelled: () => ctx.isCancelled(),
        runCommand:
          runExec && execution
            ? async (cmd) =>
                (await import("@/lib/sandbox/docker")).runAgentCommand({
                  runId,
                  root: fetched.dir,
                  command: cmd,
                })
            : undefined,
      });
      const system = graderSystemPrompt({
        purpose: evaluation.purpose,
        context: ContextSchema.parse(evaluation.context ?? {}),
        rubric,
        executionEnabled: !!execution,
      });
      const firstUser = graderUserMessage({ facts, rubric, toolBudget: preset.toolBudget, execution });
      const before = ctx.usage;
      const result =
        env().LLM_MODE === "mock"
          ? await runMockAgent(session, { root: fetched.dir, facts, isCancelled: () => ctx.isCancelled() })
          : await runLiveAgent(session, {
              system,
              firstUser,
              effort: preset.effort,
              deep: depth === "deep",
              execution: !!execution,
              signal: abort.signal,
              isCancelled: () => ctx.isCancelled(),
              onUsage: async (cumulative) => {
                ctx.usage = addUsage(before, cumulative);
                await ctx.saveUsage();
              },
            });
      ctx.usage = addUsage(before, result.usage);
      ctx.model = result.model;
      await ctx.saveUsage({ toolCalls: session.toolCalls });
      ctx.run = await db.run.update({
        where: { id: runId },
        data: {
          result: { finish: session.finished, nudges: result.nudges, refusal: result.refusal } as object,
        },
      });
      if (result.refusal)
        ctx.reviewReasons.push(
          `The model declined part of the review (LLM_REFUSAL${result.refusal.category ? `: ${result.refusal.category}` : ""}).`,
        );
      if (result.unfinished) {
        const missing = session.missingCriteria().map((c) => c.name);
        ctx.reviewReasons.push(
          session.budgetExhausted
            ? `Tool budget exhausted (BUDGET_EXHAUSTED)${missing.length ? `; not scored: ${missing.join(", ")}` : ""}.`
            : `The agent stopped without finishing${missing.length ? `; not scored: ${missing.join(", ")}` : ""}.`,
        );
      }
      await warnIfCacheCold(ctx.run, evaluation.id);
      await ctx.complete("GRADING");
    }

    // VERIFYING
    await ctx.stage("VERIFYING");
    await verifyStage(ctx, fetched.dir, rubric);
    await ctx.complete("VERIFYING");

    // SCORING (pure code, in buildReportForGroup)
    await ctx.stage("SCORING");
    const prior = (ctx.run.result ?? {}) as Record<string, unknown>;
    const status: RunStatus = ctx.reviewReasons.length ? "NEEDS_REVIEW" : "COMPLETED";
    await db.run.update({
      where: { id: runId },
      data: {
        status,
        statusReason:
          ctx.reviewReasons[0]?.match(/\(([A-Z_]+)/)?.[1] ?? (ctx.reviewReasons.length ? "REVIEW" : null),
        finishedAt: new Date(),
        completedStage: "SCORING",
        result: { ...prior, reviewReasons: ctx.reviewReasons } as object,
      },
    });
    await emitRunEvent({
      runId,
      type: "stage",
      label: status === "COMPLETED" ? "Completed" : "Completed — needs human review",
      payload: { stage: status, reasons: ctx.reviewReasons },
    });
    await finalizeGroup(ctx.run.groupId, evaluation.id);
  } catch (err) {
    if (abort.signal.aborted && !(err instanceof PipelineError && err.code === "CANCELLED")) {
      throw new PipelineError("TIMEOUT", "Run exceeded 30 minutes");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (settings.execution && executionAllowed()) {
      await import("@/lib/sandbox/docker").then((m) => m.stopSandbox(runId)).catch(() => {});
    }
  }
}

async function resetGrading(runId: string) {
  // A retried GRADING stage starts clean (scores are re-recorded by the agent).
  await db.$transaction([
    db.criterionScore.deleteMany({ where: { runId } }),
    db.fileAccess.deleteMany({ where: { runId } }),
    db.integrityFlag.deleteMany({ where: { runId, source: "agent" } }),
  ]);
}

async function scannerFlags(runId: string, facts: RepoFacts) {
  await db.integrityFlag.deleteMany({ where: { runId, source: "scanner" } });
  const rows = [
    ...facts.injectionFindings.slice(0, 20).map((f) => ({
      runId,
      severity: "high" as const,
      category: "prompt_injection",
      path: f.path,
      line: f.line,
      description: `Text aimed at AI graders: “${f.snippet}”. Treated as data; it cannot affect grading instructions.`,
      source: "scanner" as const,
    })),
    ...facts.secretFindings.slice(0, 20).map((s) => ({
      runId,
      severity:
        s.kind === "private_key" || s.kind === "committed_env_file"
          ? ("critical" as const)
          : ("high" as const),
      category: "secret",
      path: s.path,
      line: s.line,
      description:
        s.kind === "committed_env_file"
          ? `Environment file committed to the repository.`
          : `Possible ${s.kind.replace(/_/g, " ")}: ${s.redacted}`,
      source: "scanner" as const,
    })),
  ];
  if (rows.length) await db.integrityFlag.createMany({ data: rows });
}

async function verifyStage(ctx: RunContext, root: string, rubric: ReturnType<typeof RubricSchema.parse>) {
  const runId = ctx.run.id;
  const scores = await db.criterionScore.findMany({ where: { runId }, include: { evidence: true } });
  const reads = await db.fileAccess.findMany({ where: { runId, kind: "read" }, select: { path: true } });
  const readPaths = new Set(reads.map((r) => r.path));

  let discarded = 0;
  for (const s of scores) {
    const checks = await verifyEvidence(root, s.evidence, readPaths);
    await db.$transaction(
      s.evidence.map((e, i) =>
        db.evidence.update({
          where: { id: e.id },
          data: { verified: checks[i]!.verified, verifyReason: checks[i]!.reason },
        }),
      ),
    );
    s.evidence.forEach((e, i) => (e.verified = checks[i]!.verified));
    discarded += checks.filter((c) => !c.verified).length;
    const verifiedCount = checks.filter((c) => c.verified).length;
    if (s.status === "scored" && verifiedCount < 2 && s.confidence !== "low") {
      await db.criterionScore.update({ where: { id: s.id }, data: { confidence: "low" } });
      s.confidence = "low";
    }
  }
  await emitRunEvent({
    runId,
    type: discarded ? "warning" : "note",
    label: discarded
      ? `Discarded ${discarded} evidence item(s) that didn't match the code`
      : "All evidence verified against the snapshot",
    payload: { discarded },
  });

  const completeness = checkCompleteness(
    rubric,
    scores.map((s) => ({ criterionId: s.criterionId, status: s.status, score: s.score })),
  );
  for (const id of completeness.missing) {
    const c = rubric.criteria.find((x) => x.id === id);
    ctx.reviewReasons.push(`“${c?.name ?? id}” was not scored by the agent.`);
  }
  ctx.reviewReasons.push(...completeness.problems);

  const scored = scores.filter((s) => s.status !== "insufficient_evidence" || s.evidence.length);
  if (scored.length === 0) return;
  try {
    const forVerifier = scores.map((s) => ({
      criterionId: s.criterionId,
      status: s.status,
      score: s.score,
      confidence: s.confidence,
      rationale: s.rationale,
      evidence: s.evidence.map((e) => ({
        path: e.path,
        startLine: e.startLine,
        endLine: e.endLine,
        kind: e.kind,
        verified: e.verified,
      })),
    }));
    const { output, usage, model } = await runVerifier({ root, rubric, scores: forVerifier });
    await ctx.addUsage(usage, model === "mock-claude" ? undefined : ctx.model);
    for (const v of output.verdicts) {
      const row = scores.find((s) => s.criterionId === v.criterionId);
      if (row) await db.criterionScore.update({ where: { id: row.id }, data: { verifier: v } });
    }
    const reasons = verifierNeedsReview(rubric, forVerifier, output);
    ctx.reviewReasons.push(...reasons);
    const prior = (ctx.run.result ?? {}) as Record<string, unknown>;
    ctx.run = await db.run.update({
      where: { id: runId },
      data: { result: { ...prior, crossCriterionIssues: output.crossCriterionIssues } as object },
    });
    await emitRunEvent({
      runId,
      type: reasons.length ? "warning" : "note",
      label: reasons.length
        ? `Verifier disagreed on ${reasons.length} criteria`
        : "Verifier agreed with the scores",
      payload: { verdicts: output.verdicts.map((v) => ({ criterionId: v.criterionId, verdict: v.verdict })) },
    });
  } catch (err) {
    if (err instanceof LlmRefusalError) {
      ctx.reviewReasons.push("The verifier declined to review (LLM_REFUSAL).");
      return;
    }
    throw err;
  }
}

/** After a run ends: build the group's report when all passes are done; close the evaluation when idle. */
export async function finalizeGroup(groupId: string | null, evaluationId: string) {
  if (groupId) await buildReportForGroup(groupId);
  const active = await db.run.count({
    where: { submission: { evaluationId }, status: { notIn: TERMINAL } },
  });
  if (active === 0) {
    await db.evaluation.updateMany({
      where: { id: evaluationId, status: "running" },
      data: { status: "completed" },
    });
  }
}

async function warnIfCacheCold(run: Run, evaluationId: string) {
  if (env().LLM_MODE === "mock" || run.cacheRead > 0) return;
  const priorCold = await db.run.count({
    where: { id: { not: run.id }, submission: { evaluationId }, tokensIn: { gt: 0 }, cacheRead: 0 },
  });
  if (priorCold > 0) {
    const msg =
      "Prompt cache never hit across runs in this evaluation — check the system prompt is byte-stable.";
    if (env().NODE_ENV !== "production") console.warn(`[pipeline] ${msg}`);
    await emitRunEvent({ runId: run.id, type: "warning", label: msg, payload: {} });
  }
}

/**
 * BullMQ worker bootstrap. Runs as its own process: `pnpm worker`.
 * Maps failures to spec §14 codes; retries rate limits (≤5) and 5xx/network errors (≤3) with backoff.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Worker, type Job } from "bullmq";
import { RUN_QUEUE } from "@/lib/config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { FAILURE_HELP, PipelineError, type FailureCode } from "@/lib/errors";
import { emitRunEvent } from "@/lib/events";
import { CancelledError } from "@/lib/grading/session";
import { LlmOutputError, LlmRefusalError } from "@/lib/llm/types";
import type { RunJobData } from "@/lib/queue";
import { createRedis } from "@/lib/redis";
import { finalizeGroup, processRun } from "./pipeline";

const MAX_RATE_LIMIT_ATTEMPTS = 5;
const MAX_SERVER_ERROR_ATTEMPTS = 3;

async function fail(
  runId: string,
  code: FailureCode,
  message: string,
  status: "FAILED" | "NEEDS_REVIEW" | "CANCELLED" = "FAILED",
) {
  const run = await db.run.update({
    where: { id: runId },
    data: { status, statusReason: code, finishedAt: new Date() },
    include: { submission: { select: { evaluationId: true } } },
  });
  await emitRunEvent({
    runId,
    type: status === "CANCELLED" ? "note" : "error",
    label: status === "CANCELLED" ? "Run cancelled" : `${code}: ${message}`,
    payload: { code, message, help: FAILURE_HELP[code] },
  });
  await finalizeGroup(run.groupId, run.submission.evaluationId);
}

async function handle(job: Job<RunJobData>) {
  const { runId } = job.data;
  try {
    await processRun(runId);
  } catch (err) {
    const attempt = job.attemptsMade + 1;
    const scores = await db.criterionScore.count({ where: { runId } });
    if (err instanceof CancelledError || (err instanceof PipelineError && err.code === "CANCELLED")) {
      await fail(runId, "CANCELLED", "Cancelled by a user", "CANCELLED");
      return;
    }
    if (err instanceof PipelineError) {
      // TIMEOUT keeps partial results for review when there are any.
      if (err.code === "TIMEOUT" && scores > 0) await fail(runId, "TIMEOUT", err.message, "NEEDS_REVIEW");
      else await fail(runId, err.code, err.message);
      return;
    }
    if (err instanceof Anthropic.RateLimitError) {
      if (attempt < MAX_RATE_LIMIT_ATTEMPTS) return requeue(runId, "LLM_RATE_LIMITED", err);
      await fail(runId, "LLM_RATE_LIMITED", "Rate limited after 5 attempts");
      return;
    }
    if (
      err instanceof Anthropic.InternalServerError ||
      err instanceof Anthropic.APIConnectionError ||
      (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500)
    ) {
      if (attempt < MAX_SERVER_ERROR_ATTEMPTS) return requeue(runId, "LLM_ERROR", err);
      await fail(runId, "LLM_ERROR", err.message);
      return;
    }
    if (err instanceof LlmRefusalError) {
      await fail(runId, "LLM_REFUSAL", err.message, "NEEDS_REVIEW");
      return;
    }
    if (err instanceof Anthropic.APIError || err instanceof LlmOutputError) {
      // 4xx and unparsable output are not retried.
      await fail(runId, "LLM_ERROR", err.message);
      return;
    }
    console.error(`[worker] run ${runId} crashed`, err);
    await fail(runId, "INTERNAL", (err as Error).message ?? "Unexpected error");
  }

  async function requeue(id: string, code: FailureCode, err: Error): Promise<never> {
    await db.run.update({ where: { id }, data: { status: "QUEUED", statusReason: code } });
    await emitRunEvent({
      runId: id,
      type: "warning",
      label: `${code} — retrying with backoff`,
      payload: { message: err.message },
    });
    throw err; // BullMQ retries with exponential backoff
  }
}

async function main() {
  const e = env();
  const connection = createRedis({ forBullmq: true });
  const pong = await connection.ping();
  console.log(`[worker] connected to Redis (${pong}) at ${e.REDIS_URL}; LLM_MODE=${e.LLM_MODE}`);

  const worker = new Worker<RunJobData>(RUN_QUEUE, handle, {
    connection,
    concurrency: e.WORKER_CONCURRENCY,
    lockDuration: 120_000,
  });

  worker.on("ready", () =>
    console.log(`[worker] listening on queue "${RUN_QUEUE}" (concurrency ${e.WORKER_CONCURRENCY})`),
  );
  worker.on("active", (job) => console.log(`[worker] run ${job.data.runId} started`));
  worker.on("completed", (job) => console.log(`[worker] run ${job.data.runId} done`));
  worker.on("failed", (job, err) =>
    console.warn(`[worker] run ${job?.data.runId} attempt failed: ${err.message}`),
  );

  const shutdown = async () => {
    console.log("[worker] shutting down…");
    await worker.close();
    await connection.quit();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] failed to start:", err);
  process.exit(1);
});

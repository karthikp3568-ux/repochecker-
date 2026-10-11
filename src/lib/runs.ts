import { createId } from "./ids";
import { db } from "./db";
import { env } from "./env";
import { runQueue } from "./queue";
import type { Depth } from "./config";

export const ACTIVE_STATUSES = [
  "QUEUED",
  "FETCHING",
  "INDEXING",
  "EXECUTING",
  "GRADING",
  "VERIFYING",
  "SCORING",
] as const;

const JOB_OPTS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 15_000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
};

export async function enqueueRun(runId: string, attempt = 1) {
  await runQueue().add("run", { runId }, { ...JOB_OPTS, jobId: `${runId}-${attempt}` });
}

/** Create one run group (N consensus passes) per submission and enqueue them. */
export async function startRuns(input: {
  evaluationId: string;
  rubricVersionId: string;
  submissionIds: string[];
  depth: Depth;
  consensus: 1 | 3;
  /** false = create runs only (the caller processes them in-process, e.g. the eval script). */
  enqueue?: boolean;
}) {
  const runIds: string[] = [];
  for (const submissionId of input.submissionIds) {
    const groupId = createId();
    for (let i = 0; i < input.consensus; i++) {
      const run = await db.run.create({
        data: {
          submissionId,
          rubricVersionId: input.rubricVersionId,
          groupId,
          consensusIndex: i,
          depth: input.depth,
          model: env().LLM_MODE === "mock" ? "mock-claude" : env().CLAUDE_MODEL,
          status: "QUEUED",
        },
      });
      runIds.push(run.id);
    }
  }
  if (input.enqueue !== false) for (const id of runIds) await enqueueRun(id);
  await db.evaluation.update({ where: { id: input.evaluationId }, data: { status: "running" } });
  return runIds;
}

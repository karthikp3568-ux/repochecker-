import { Queue } from "bullmq";
import { RUN_QUEUE } from "./config";
import { createRedis } from "./redis";

export type RunJobData = { runId: string };

const globalForQueue = globalThis as unknown as { runQueue?: Queue<RunJobData> };

export function runQueue(): Queue<RunJobData> {
  globalForQueue.runQueue ??= new Queue<RunJobData>(RUN_QUEUE, {
    connection: createRedis({ forBullmq: true }),
  });
  return globalForQueue.runQueue;
}

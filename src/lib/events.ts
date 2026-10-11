import type { RunEventType } from "@/generated/prisma/client";
import { RUN_EVENTS_CHANNEL } from "./config";
import { db } from "./db";
import { redis } from "./redis";

export type RunEventInput = {
  runId: string;
  type: RunEventType;
  label: string;
  payload?: Record<string, unknown>;
};

/** Persist a RunEvent and publish it for live SSE subscribers (spec §3.1). */
export async function emitRunEvent(e: RunEventInput) {
  const row = await db.runEvent.create({
    data: { runId: e.runId, type: e.type, label: e.label, payload: (e.payload ?? {}) as object },
  });
  await redis()
    .publish(RUN_EVENTS_CHANNEL(e.runId), JSON.stringify(row))
    .catch((err: unknown) => console.warn("[events] publish failed", err));
  return row;
}

import { ApiError, requireEvaluation, route } from "@/lib/api";
import { RUN_EVENTS_CHANNEL } from "@/lib/config";
import { db } from "@/lib/db";
import { createRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

const TERMINAL = new Set(["COMPLETED", "NEEDS_REVIEW", "FAILED", "CANCELLED"]);

/** SSE: replay stored events, then stream live ones from Redis pub/sub until the run ends. */
export const GET = route<{ id: string }>(async ({ req, params, user }) => {
  const run = await db.run.findUnique({ where: { id: params.id }, include: { submission: true } });
  if (!run) throw new ApiError(404, "NOT_FOUND", "Run not found.");
  await requireEvaluation(run.submission.evaluationId, user.id);

  const encoder = new TextEncoder();
  const sub = createRedis();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const seen = new Set<string>();
      const send = (event: string, data: unknown, id?: string) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      const close = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        await sub.quit().catch(() => {});
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", () => void close());

      // Subscribe first so nothing is lost between replay and live.
      const buffered: string[] = [];
      let replaying = true;
      sub.on("message", async (_channel, raw) => {
        if (replaying) {
          buffered.push(raw);
          return;
        }
        await deliver(raw);
      });
      const deliver = async (raw: string) => {
        const e = JSON.parse(raw) as { id: string; type: string; payload?: { stage?: string } };
        if (seen.has(e.id)) return;
        seen.add(e.id);
        send("run-event", e, e.id);
        if (e.type === "stage" && e.payload?.stage && TERMINAL.has(e.payload.stage)) {
          send("end", { status: e.payload.stage });
          await close();
        } else if (e.type === "error" || (e.type === "note" && /cancel/i.test(JSON.stringify(e)))) {
          const now = await db.run.findUnique({ where: { id: run.id }, select: { status: true } });
          if (now && TERMINAL.has(now.status)) {
            send("end", { status: now.status });
            await close();
          }
        }
      };
      await sub.subscribe(RUN_EVENTS_CHANNEL(run.id));

      const events = await db.runEvent.findMany({ where: { runId: run.id }, orderBy: { ts: "asc" } });
      for (const e of events) {
        seen.add(e.id);
        send("run-event", e, e.id);
      }
      replaying = false;
      for (const raw of buffered) await deliver(raw);

      const current = await db.run.findUnique({ where: { id: run.id } });
      send("status", {
        status: current?.status,
        tokensIn: current?.tokensIn,
        tokensOut: current?.tokensOut,
        costUsd: current?.costUsd,
      });
      if (current && TERMINAL.has(current.status)) {
        send("end", { status: current.status });
        await close();
        return;
      }
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15_000);
    },
    async cancel() {
      closed = true;
      clearInterval(heartbeat);
      await sub.quit().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
});

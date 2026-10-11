import { ApiError, requireEvaluation, route } from "@/lib/api";
import { db } from "@/lib/db";
import { emitRunEvent } from "@/lib/events";
import { runQueue } from "@/lib/queue";
import { ACTIVE_STATUSES } from "@/lib/runs";

/** Mark the run cancelled; the worker checks between stages and during grading. */
export const POST = route<{ id: string }>(async ({ params, user }) => {
  const run = await db.run.findUnique({ where: { id: params.id }, include: { submission: true } });
  if (!run) throw new ApiError(404, "NOT_FOUND", "Run not found.");
  await requireEvaluation(run.submission.evaluationId, user.id, "judge");
  if (!(ACTIVE_STATUSES as readonly string[]).includes(run.status)) {
    throw new ApiError(409, "NOT_ACTIVE", `Run is already ${run.status.toLowerCase()}.`);
  }
  await db.run.update({
    where: { id: run.id },
    data: { status: "CANCELLED", statusReason: "CANCELLED", finishedAt: new Date() },
  });
  // Drop it from the queue if no worker has picked it up yet.
  const jobs = await runQueue().getJobs(["waiting", "delayed", "prioritized"]);
  await Promise.all(jobs.filter((j) => j.data.runId === run.id).map((j) => j.remove().catch(() => {})));
  await emitRunEvent({
    runId: run.id,
    type: "note",
    label: "Cancelled by a judge",
    payload: { by: user.id },
  });
  return { ok: true };
});

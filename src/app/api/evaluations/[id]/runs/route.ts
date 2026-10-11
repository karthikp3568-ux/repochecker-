import { z } from "zod";
import { ApiError, parseBody, requireEvaluation, route } from "@/lib/api";
import { DEPTH_PRESETS, type Depth } from "@/lib/config";
import { db } from "@/lib/db";
import { readSettings } from "@/lib/evaluation";
import { rateLimit } from "@/lib/rate-limit";
import { ACTIVE_STATUSES, startRuns } from "@/lib/runs";
import { executionAllowed } from "@/lib/sandbox";

const BodySchema = z.object({
  depth: z.enum(Object.keys(DEPTH_PRESETS) as [Depth, ...Depth[]]),
  consensus: z.union([z.literal(1), z.literal(3)]).default(1),
  execution: z.boolean().default(false),
  submissionIds: z.array(z.string()).max(1000).optional(),
});

/** Start grading: one run group per submission against the active rubric version. */
export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, BodySchema);
  const { evaluation } = await requireEvaluation(params.id, user.id, "judge");
  if (!evaluation.activeRubricVersionId)
    throw new ApiError(409, "NO_RUBRIC", "Lock a rubric before grading.");
  if (body.execution && !executionAllowed()) {
    throw new ApiError(
      400,
      "EXECUTION_DISABLED",
      "Execution mode is disabled on this server (ENABLE_EXECUTION=false).",
    );
  }
  await rateLimit(user.id, "runStart");

  const submissions = await db.submission.findMany({
    where: { evaluationId: evaluation.id, ...(body.submissionIds ? { id: { in: body.submissionIds } } : {}) },
    select: { id: true },
  });
  if (submissions.length === 0) throw new ApiError(400, "NO_SUBMISSIONS", "Add submissions first.");
  const busy = await db.run.findMany({
    where: { submissionId: { in: submissions.map((s) => s.id) }, status: { in: [...ACTIVE_STATUSES] } },
    select: { submissionId: true },
  });
  const busyIds = new Set(busy.map((b) => b.submissionId));
  const ids = submissions.map((s) => s.id).filter((id) => !busyIds.has(id));
  if (ids.length === 0)
    throw new ApiError(409, "ALREADY_RUNNING", "Every selected submission is already being graded.");

  await db.evaluation.update({
    where: { id: evaluation.id },
    data: {
      settings: {
        ...readSettings(evaluation.settings),
        depth: body.depth,
        consensus: body.consensus,
        execution: body.execution,
      },
    },
  });
  const runIds = await startRuns({
    evaluationId: evaluation.id,
    rubricVersionId: evaluation.activeRubricVersionId,
    submissionIds: ids,
    depth: body.depth,
    consensus: body.consensus,
  });
  return Response.json({ runIds, skipped: busyIds.size }, { status: 201 });
});

/** Latest run per submission (for the submissions table). */
export const GET = route<{ id: string }>(async ({ params, user }) => {
  const { evaluation } = await requireEvaluation(params.id, user.id);
  return db.run.findMany({
    where: { submission: { evaluationId: evaluation.id } },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
});

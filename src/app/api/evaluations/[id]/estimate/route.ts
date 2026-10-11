import { z } from "zod";
import { parseBody, requireEvaluation, route } from "@/lib/api";
import { DEPTH_PRESETS, type Depth } from "@/lib/config";
import { db } from "@/lib/db";
import { estimate } from "@/lib/estimate";
import { sourceKeyFor } from "@/lib/ingest/fetch";

const BodySchema = z.object({
  depth: z.enum(Object.keys(DEPTH_PRESETS) as [Depth, ...Depth[]]),
  consensus: z.union([z.literal(1), z.literal(3)]).default(1),
  submissionIds: z.array(z.string()).optional(),
});

export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, BodySchema);
  const { evaluation } = await requireEvaluation(params.id, user.id);
  const submissions = await db.submission.findMany({
    where: { evaluationId: evaluation.id, ...(body.submissionIds ? { id: { in: body.submissionIds } } : {}) },
  });
  // Use indexed LOC where available; unknown sizes use the 5k-LOC prior.
  const snaps = await db.repoSnapshot.findMany({
    where: { OR: submissions.map((s) => ({ sourceKey: sourceKeyFor(s), commitSha: s.commitSha })) },
    select: { sourceKey: true, commitSha: true, facts: true },
  });
  const locs = submissions.map((s) => {
    const snap = snaps.find((x) => x.sourceKey === sourceKeyFor(s) && x.commitSha === s.commitSha);
    return (snap?.facts as { size?: { totalLoc?: number } } | null)?.size?.totalLoc ?? 0;
  });
  return estimate({ depth: body.depth, consensus: body.consensus, locs });
});

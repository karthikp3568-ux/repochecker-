import { requireEvaluation, route } from "@/lib/api";
import { db } from "@/lib/db";
import { diffRubrics } from "@/lib/rubric/diff";
import { RubricSchema } from "@/lib/rubric/schema";

/** All locked versions, each with a diff against the previous version. */
export const GET = route<{ id: string }>(async ({ params, user }) => {
  const { evaluation } = await requireEvaluation(params.id, user.id);
  const versions = await db.rubricVersion.findMany({
    where: { evaluationId: evaluation.id },
    orderBy: { version: "asc" },
    include: { lockedBy: { select: { name: true, email: true } } },
  });
  return versions.map((v, i) => {
    const rubric = RubricSchema.parse(v.rubric);
    const prev = i > 0 ? RubricSchema.parse(versions[i - 1]!.rubric) : null;
    return {
      ...v,
      rubric,
      active: v.id === evaluation.activeRubricVersionId,
      diffFromPrevious: prev ? diffRubrics(prev, rubric) : null,
    };
  });
});

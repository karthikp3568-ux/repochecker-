import { z } from "zod";
import { parseBody, requireEvaluation, route } from "@/lib/api";
import { RubricSchema } from "@/lib/rubric/schema";
import { getOrCreateDraft, lockRubric } from "@/lib/rubric/service";

const BodySchema = z.object({ rubric: RubricSchema });

/** Validate (spec §4.4) and create an immutable RubricVersion. */
export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, BodySchema);
  const { evaluation } = await requireEvaluation(params.id, user.id, "judge");
  const draft = await getOrCreateDraft(evaluation.id);
  const version = await lockRubric(evaluation, draft, body.rubric, user.id);
  return Response.json(version, { status: 201 });
});

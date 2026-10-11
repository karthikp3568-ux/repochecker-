import { z } from "zod";
import { ApiError, parseBody, requireEvaluation, route } from "@/lib/api";
import { db } from "@/lib/db";
import { normalizeRubric } from "@/lib/rubric/normalize";
import { RubricSchema } from "@/lib/rubric/schema";
import { getOrCreateDraft } from "@/lib/rubric/service";

const BodySchema = z.object({ templateId: z.string().min(1) });

/** Prefill the working rubric from a saved template (fresh criterion ids; fully editable). */
export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const { templateId } = await parseBody(req, BodySchema);
  const { evaluation } = await requireEvaluation(params.id, user.id, "judge");
  const template = await db.rubricTemplate.findFirst({ where: { id: templateId, ownerId: user.id } });
  if (!template) throw new ApiError(404, "NOT_FOUND", "Template not found.");
  const source = RubricSchema.parse(template.rubric);
  const rubric = normalizeRubric({ ...source, criteria: source.criteria.map((c) => ({ ...c, id: null })) });
  const draft = await getOrCreateDraft(evaluation.id);
  await db.rubricDraft.update({
    where: { id: draft.id },
    data: { rubric, intent: draft.intent || `Based on template: ${template.name}` },
  });
  return { ok: true };
});

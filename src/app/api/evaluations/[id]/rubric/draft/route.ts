import { z } from "zod";
import { parseBody, requireEvaluation, route } from "@/lib/api";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { RubricSchema } from "@/lib/rubric/schema";
import { draftRounds, draftRubric, getOrCreateDraft, runBuilder } from "@/lib/rubric/service";

export const GET = route<{ id: string }>(async ({ params, user }) => {
  const { evaluation } = await requireEvaluation(params.id, user.id);
  const draft = await getOrCreateDraft(evaluation.id);
  return { ...draft, rounds: draftRounds(draft), rubric: draftRubric(draft) };
});

const BuildSchema = z.object({
  intent: z.string().trim().min(1, "Describe what matters to you").max(20_000),
  existingRubric: z.string().max(50_000).nullable().optional(),
  existingRubricFileName: z.string().max(200).nullable().optional(),
});

/** Start (or restart) the builder from the user's intent. */
export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, BuildSchema);
  const { evaluation } = await requireEvaluation(params.id, user.id, "judge");
  await rateLimit(user.id, "rubricBuilder");
  const existing = await getOrCreateDraft(evaluation.id);
  const draft = await db.rubricDraft.update({
    where: { id: existing.id },
    data: {
      intent: body.intent,
      attachments: {
        existingRubric: body.existingRubric ?? null,
        existingRubricFileName: body.existingRubricFileName ?? null,
      },
      questions: [],
      answers: [],
    },
  });
  return runBuilder(evaluation, draft, []);
});

const SaveSchema = z.object({
  intent: z.string().max(20_000).optional(),
  rubric: RubricSchema.optional(),
});

/** Save manual edits to the working copy (autosave). */
export const PUT = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, SaveSchema);
  const { evaluation } = await requireEvaluation(params.id, user.id, "judge");
  const draft = await getOrCreateDraft(evaluation.id);
  const saved = await db.rubricDraft.update({
    where: { id: draft.id },
    data: { intent: body.intent, rubric: body.rubric },
  });
  return { ok: true, updatedAt: saved.updatedAt };
});

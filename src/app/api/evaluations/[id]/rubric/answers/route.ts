import { z } from "zod";
import { parseBody, requireEvaluation, route } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { AnswerSchema } from "@/lib/rubric/schema";
import { answerQuestions, getOrCreateDraft } from "@/lib/rubric/service";

const BodySchema = z.object({
  answers: z.array(AnswerSchema).max(4).default([]),
  skip: z.boolean().default(false),
});

export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, BodySchema);
  const { evaluation } = await requireEvaluation(params.id, user.id, "judge");
  await rateLimit(user.id, "rubricBuilder");
  const draft = await getOrCreateDraft(evaluation.id);
  return answerQuestions(evaluation, draft, body.answers, body.skip);
});

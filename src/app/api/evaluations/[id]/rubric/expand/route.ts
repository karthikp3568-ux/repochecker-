import { z } from "zod";
import { parseBody, requireEvaluation, route } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { RubricSchema } from "@/lib/rubric/schema";
import { expandCriterion } from "@/lib/rubric/service";

const BodySchema = z.object({
  sentence: z.string().trim().min(3).max(1000),
  rubric: RubricSchema,
});

export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, BodySchema);
  const { evaluation } = await requireEvaluation(params.id, user.id, "judge");
  await rateLimit(user.id, "rubricBuilder");
  return expandCriterion(evaluation, body.rubric, body.sentence);
});

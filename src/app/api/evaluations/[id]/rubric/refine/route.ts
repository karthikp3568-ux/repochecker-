import { z } from "zod";
import { parseBody, requireEvaluation, route } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { RubricSchema } from "@/lib/rubric/schema";
import { refineRubric } from "@/lib/rubric/service";

const BodySchema = z.object({
  instruction: z.string().trim().min(1).max(4000),
  rubric: RubricSchema,
});

/** Returns a proposed rubric + change list. Nothing is saved until the user accepts. */
export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, BodySchema);
  const { evaluation } = await requireEvaluation(params.id, user.id, "judge");
  await rateLimit(user.id, "rubricBuilder");
  return refineRubric(evaluation, body.rubric, body.instruction);
});

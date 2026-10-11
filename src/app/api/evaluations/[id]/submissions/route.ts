import { z } from "zod";
import { parseBody, requireEvaluation, route } from "@/lib/api";
import { db } from "@/lib/db";
import { createFromRows, SubmissionItemSchema, validateItems } from "@/lib/submissions";

export const GET = route<{ id: string }>(async ({ params, user }) => {
  const { evaluation } = await requireEvaluation(params.id, user.id);
  return db.submission.findMany({ where: { evaluationId: evaluation.id }, orderBy: { createdAt: "asc" } });
});

const BodySchema = z.object({
  items: z.array(SubmissionItemSchema).min(1).max(1000),
  /** Validate only (preview table); nothing is created. */
  dryRun: z.boolean().default(false),
});

export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, BodySchema);
  const { evaluation } = await requireEvaluation(params.id, user.id, "judge");
  const rows = await validateItems(evaluation.id, body.items);
  const created = body.dryRun ? [] : await createFromRows(evaluation.id, rows, user.id);
  return { rows, created: created.length };
});

import { z } from "zod";
import { parseBody, requireEvaluation, route } from "@/lib/api";
import { db } from "@/lib/db";
import { readSettings, SettingsSchema } from "@/lib/evaluation";
import { recomputeReport } from "@/lib/report";
import { ContextSchema, PURPOSES } from "@/lib/rubric/schema";

export const GET = route<{ id: string }>(async ({ params, user }) => {
  const { evaluation, role } = await requireEvaluation(params.id, user.id);
  const [draft, activeRubric, submissionCount] = await Promise.all([
    db.rubricDraft.findUnique({ where: { evaluationId: evaluation.id } }),
    evaluation.activeRubricVersionId
      ? db.rubricVersion.findUnique({ where: { id: evaluation.activeRubricVersionId } })
      : null,
    db.submission.count({ where: { evaluationId: evaluation.id } }),
  ]);
  return {
    ...evaluation,
    settings: readSettings(evaluation.settings),
    role,
    draft,
    activeRubric,
    submissionCount,
  };
});

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  purpose: z.enum(PURPOSES).optional(),
  context: ContextSchema.optional(),
  settings: SettingsSchema.partial().optional(),
  status: z.enum(["archived", "completed", "rubric_ready", "draft"]).optional(),
});

export const PATCH = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await parseBody(req, PatchSchema);
  const { evaluation } = await requireEvaluation(
    params.id,
    user.id,
    body.status === "archived" ? "owner" : "judge",
  );
  const before = readSettings(evaluation.settings);
  const settings = body.settings ? { ...before, ...body.settings } : undefined;
  const updated = await db.evaluation.update({
    where: { id: evaluation.id },
    data: {
      name: body.name,
      purpose: body.purpose,
      context: body.context,
      settings,
      status: body.status,
      ...(body.context ? { deadline: body.context.deadline ? new Date(body.context.deadline) : null } : {}),
    },
  });
  // Scoring policy changed: recompute every report (pure code, no LLM).
  if (settings && settings.treatInsufficientAsZero !== before.treatInsufficientAsZero) {
    const reports = await db.report.findMany({
      where: { submission: { evaluationId: evaluation.id } },
      select: { id: true },
    });
    for (const r of reports) await recomputeReport(r.id);
  }
  return updated;
});

export const DELETE = route<{ id: string }>(async ({ params, user }) => {
  const { evaluation } = await requireEvaluation(params.id, user.id, "owner");
  await db.$transaction([
    db.evaluation.update({ where: { id: evaluation.id }, data: { activeRubricVersionId: null } }),
    db.evaluation.delete({ where: { id: evaluation.id } }),
  ]);
  return { ok: true };
});

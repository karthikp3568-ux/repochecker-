import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Evaluation, MemberRole } from "@/generated/prisma/client";
import { auth } from "./auth";
import { db } from "./db";
import { LlmOutputError, LlmRefusalError } from "./llm/types";

/** Errors returned as `{ error: { code, message } }` (spec §12). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export type SessionUser = { id: string; name?: string | null; email?: string | null };

function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      { status: err.status },
    );
  }
  if (err instanceof z.ZodError) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: z.prettifyError(err), details: err.issues } },
      { status: 400 },
    );
  }
  if (err instanceof LlmRefusalError) {
    return Response.json({ error: { code: "LLM_REFUSAL", message: err.message } }, { status: 422 });
  }
  if (err instanceof LlmOutputError) {
    return Response.json({ error: { code: "LLM_ERROR", message: err.message } }, { status: 502 });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return Response.json(
      { error: { code: "LLM_RATE_LIMITED", message: "The AI service is busy. Please retry in a moment." } },
      { status: 503 },
    );
  }
  if (err instanceof Anthropic.APIError) {
    console.error("[api] Anthropic error", err.status, err.message);
    return Response.json(
      { error: { code: "LLM_ERROR", message: "The AI service returned an error. Please retry." } },
      { status: 502 },
    );
  }
  console.error("[api] unhandled", err);
  return Response.json({ error: { code: "INTERNAL", message: "Something went wrong." } }, { status: 500 });
}

type Ctx<P> = { params: Promise<P> };

/** Wrap a route handler: auth (unless public), error formatting, JSON serialization. */
export function route<P extends Record<string, string> = Record<string, never>>(
  fn: (args: { req: Request; params: P; user: SessionUser }) => Promise<unknown>,
) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const session = await auth();
      if (!session?.user?.id) throw new ApiError(401, "UNAUTHORIZED", "Sign in required.");
      const result = await fn({ req, params: await ctx.params, user: session.user as SessionUser });
      return result instanceof Response ? result : Response.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Same as `route` but without auth (public share links). */
export function publicRoute<P extends Record<string, string> = Record<string, never>>(
  fn: (args: { req: Request; params: P }) => Promise<unknown>,
) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const result = await fn({ req, params: await ctx.params });
      return result instanceof Response ? result : Response.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "BAD_JSON", "Request body must be JSON.");
  }
  return schema.parse(raw);
}

const RANK: Record<MemberRole, number> = { viewer: 1, judge: 2, owner: 3 };

export async function roleFor(evaluation: Pick<Evaluation, "id" | "ownerId">, userId: string) {
  if (evaluation.ownerId === userId) return "owner" as const;
  const m = await db.evaluationMember.findUnique({
    where: { evaluationId_userId: { evaluationId: evaluation.id, userId } },
  });
  return m?.role ?? null;
}

/** Load an evaluation and require the user to hold at least `min` role. 404 hides existence. */
export async function requireEvaluation(evaluationId: string, userId: string, min: MemberRole = "viewer") {
  const evaluation = await db.evaluation.findUnique({ where: { id: evaluationId } });
  if (!evaluation) throw new ApiError(404, "NOT_FOUND", "Evaluation not found.");
  const role = await roleFor(evaluation, userId);
  if (!role) throw new ApiError(404, "NOT_FOUND", "Evaluation not found.");
  if (RANK[role] < RANK[min]) throw new ApiError(403, "FORBIDDEN", `This action requires the ${min} role.`);
  return { evaluation, role };
}

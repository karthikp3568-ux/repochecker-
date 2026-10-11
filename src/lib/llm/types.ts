import type { z } from "zod";
import type { Usage } from "./pricing";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Names every structured LLM call so mock mode can return the right canned output. */
export type StructuredTask = "rubric.build" | "rubric.refine" | "rubric.expand" | "verify" | "compare";

export type StructuredRequest<S extends z.ZodType> = {
  task: StructuredTask;
  /** Static, byte-stable instructions. Cached (cache_control at its end). Never put IDs/timestamps here. */
  system: string;
  /** Per-request content (user inputs, rubric JSON, etc.). */
  user: string;
  schema: S;
  effort: Effort;
  maxTokens?: number;
};

export type StructuredResult<T> = { data: T; usage: Usage; model: string };

export interface LlmClient {
  readonly mode: "live" | "mock";
  structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>>;
}

export class LlmRefusalError extends Error {
  constructor(public readonly category: string | null) {
    super(`Model refused the request${category ? ` (${category})` : ""}`);
    this.name = "LlmRefusalError";
  }
}

export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}

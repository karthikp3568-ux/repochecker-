import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "../env";
import { createMockClient } from "./mock";
import "./mock-fixtures";
import type { Usage } from "./pricing";
import {
  LlmOutputError,
  LlmRefusalError,
  type LlmClient,
  type StructuredRequest,
  type StructuredResult,
} from "./types";

/** Server-side refusal fallback (spec §6). `"default"` routes by refusal category. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function usageFrom(u: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): Usage {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

function createLiveClient(): LlmClient {
  const sdk = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  const model = env().CLAUDE_MODEL;

  async function once<S extends z.ZodType>(
    req: StructuredRequest<S>,
  ): Promise<StructuredResult<z.infer<S>> | null> {
    // Adaptive thinking is always on for this model; no temperature/top_p (rejected).
    const response = await sdk.beta.messages.parse({
      model,
      max_tokens: req.maxTokens ?? 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.user }],
    });
    if (response.stop_reason === "refusal") {
      throw new LlmRefusalError(response.stop_details?.category ?? null);
    }
    if (response.stop_reason === "max_tokens") {
      throw new LlmOutputError(`Output truncated at max_tokens for ${req.task}`);
    }
    const parsed = response.parsed_output;
    if (parsed == null) return null;
    return { data: parsed as z.infer<S>, usage: usageFrom(response.usage), model: response.model };
  }

  return {
    mode: "live",
    async structured(req) {
      // Retry once when the structured output fails to parse (spec §6).
      const first = await once(req);
      if (first) return first;
      const second = await once(req);
      if (second) return second;
      throw new LlmOutputError(`Structured output for ${req.task} could not be parsed`);
    },
  };
}

const globalForLlm = globalThis as unknown as { llm?: LlmClient };

/** The app-wide LLM client. LLM_MODE=mock swaps in canned responses (zero API cost). */
export function llm(): LlmClient {
  globalForLlm.llm ??= env().LLM_MODE === "mock" ? createMockClient() : createLiveClient();
  return globalForLlm.llm;
}

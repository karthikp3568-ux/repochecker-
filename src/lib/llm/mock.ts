import type { z } from "zod";
import { ZERO_USAGE } from "./pricing";
import type { LlmClient, StructuredRequest, StructuredTask } from "./types";

/**
 * Canned responses per task. Each phase registers realistic fixtures here
 * (rubric drafts in Phase 1, scores/verifier output in Phase 3) via `registerMock`.
 * Responders get the request so they can vary output (e.g. vague intent → questions).
 */
type Responder = (req: StructuredRequest<z.ZodType>) => unknown;

const responders = new Map<StructuredTask, Responder>();

export function registerMock(task: StructuredTask, responder: Responder) {
  responders.set(task, responder);
}

export const MOCK_MODEL = "mock-claude";

export function createMockClient(): LlmClient {
  return {
    mode: "mock",
    async structured(req) {
      const responder = responders.get(req.task);
      if (!responder) throw new Error(`No mock registered for LLM task "${req.task}"`);
      // Validate canned data against the real schema so mocks can't drift from the contract.
      const data = req.schema.parse(responder(req as StructuredRequest<z.ZodType>));
      return { data, usage: ZERO_USAGE, model: MOCK_MODEL };
    },
  };
}

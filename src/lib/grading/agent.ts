/**
 * Live grading driver (spec §5.2, §6): the SDK tool runner over our read-only tools, streaming,
 * with the server-side refusal fallback, prompt caching on the static system prompt, nudging
 * when the model stops early, and the tool budget enforced by the session.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessage, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { env } from "../env";
import { FALLBACK_BETA, usageFrom } from "../llm/client";
import { addUsage, ZERO_USAGE, type Usage } from "../llm/pricing";
import { nudgeMessage } from "../llm/prompts/grader";
import type { Effort } from "../llm/types";
import { CancelledError, GradingSession, TOOL_DESCRIPTIONS, ToolInputs, type ToolName } from "./session";

export type AgentResult = {
  usage: Usage;
  model: string;
  refusal: { category: string | null } | null;
  nudges: number;
  /** True when the agent never called finish (even after nudges). */
  unfinished: boolean;
};

export type AgentInput = {
  system: string;
  firstUser: string;
  effort: Effort;
  deep: boolean;
  execution: boolean;
  signal: AbortSignal;
  isCancelled: () => Promise<boolean>;
  onUsage?: (u: Usage) => Promise<void> | void;
};

const MAX_NUDGES = 2;
const CONTEXT_EDITING_BETA = "context-management-2025-06-27";

export async function runLiveAgent(session: GradingSession, input: AgentInput): Promise<AgentResult> {
  const sdk = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 2 });
  const model = env().CLAUDE_MODEL;

  // Deterministic tool order (prompt caching): definitions never vary between submissions.
  const names = (Object.keys(ToolInputs) as ToolName[]).filter((n) => n !== "run_command" || input.execution);
  const tools = names.map((name) => ({
    ...betaZodTool({
      name,
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: ToolInputs[name],
      run: (args: unknown) => session.call(name, args),
    }),
    // Streaming runner + client tools: stream large inputs (betaZodTool still validates them).
    eager_input_streaming: true,
  }));

  let usage: Usage = ZERO_USAGE;
  let servedBy = model;
  let refusal: AgentResult["refusal"] = null;
  let messages: BetaMessageParam[] = [{ role: "user", content: input.firstUser }];
  let nudges = 0;

  for (;;) {
    const runner = sdk.beta.messages.toolRunner(
      {
        model,
        max_tokens: 32000,
        stream: true,
        betas: [FALLBACK_BETA, ...(input.deep ? [CONTEXT_EDITING_BETA] : [])],
        fallbacks: "default",
        output_config: { effort: input.effort },
        // Static instructions + context + rubric: byte-identical across an evaluation → cached.
        system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        max_iterations: session.hardCap + 4,
        // Deep runs: clear old tool results server-side. Scores are recorded incrementally, so
        // losing old file reads is safe (spec §6).
        ...(input.deep
          ? { context_management: { edits: [{ type: "clear_tool_uses_20250919" as const }] } }
          : {}),
      },
      { signal: input.signal },
    );

    let last: BetaMessage | null = null;
    for await (const stream of runner) {
      const msg = await stream.finalMessage();
      last = msg;
      const u = usageFrom(msg.usage);
      usage = addUsage(usage, u);
      servedBy = msg.model;
      await input.onUsage?.(usage);
      if (await input.isCancelled()) throw new CancelledError();
      if (msg.stop_reason === "refusal") {
        refusal = { category: msg.stop_details?.category ?? null };
        break;
      }
      if (msg.stop_reason === "pause_turn") runner.pushMessages({ role: "assistant", content: msg.content });
      if (session.budgetExhausted && session.toolCalls >= session.hardCap) break;
    }

    if (refusal || session.finished) break;
    const missing = session.missingCriteria();
    if (nudges >= MAX_NUDGES) break;
    if (missing.length === 0 && session.finished) break;

    // The model stopped without finishing: nudge (at most twice), keeping the full history.
    nudges++;
    const history = [...runner.params.messages];
    if (last && history.at(-1)?.role !== "assistant")
      history.push({ role: "assistant", content: last.content });
    const text = missing.length
      ? nudgeMessage(missing.map((c) => `${c.id} (${c.name})`))
      : "Call finish with your summary and recommendations.";
    await session.event(
      "note",
      `Nudged the agent (${nudges}/${MAX_NUDGES})${missing.length ? `: ${missing.length} criteria unrecorded` : ""}`,
      {},
    );
    messages = [...history, { role: "user", content: text }];
  }

  return { usage, model: servedBy, refusal, nudges, unfinished: !session.finished };
}

/** $ per million tokens. Single source for cost math (spec §6). Cache write = 5-minute TTL rate. */
export type ModelPricing = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const PRICING: Record<string, ModelPricing> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/** Unknown models are priced as the default model so estimates never silently read $0. */
export function costUsd(model: string, u: Usage): number {
  const p = PRICING[model] ?? PRICING["claude-opus-5-5"]!;
  return (
    (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6
  );
}

/**
 * Pre-run cost/time estimate (spec §7). Uses a size-scaled prior per depth, replaced by the
 * rolling average of real runs at the same depth once enough exist (calibration over time).
 */
import { DEPTH_PRESETS, type Depth } from "./config";
import { db } from "./db";
import { env } from "./env";
import { costUsd } from "./llm/pricing";

/** Prior per run at ~5k LOC: input split into cached/uncached, output tokens, minutes. */
const PRIOR: Record<Depth, { input: number; output: number; minutes: number }> = {
  quick: { input: 220_000, output: 14_000, minutes: 3 },
  standard: { input: 600_000, output: 30_000, minutes: 7 },
  deep: { input: 1_600_000, output: 70_000, minutes: 15 },
};
const CACHED_SHARE = 0.65;

export function sizeFactor(loc: number): number {
  if (!loc) return 1;
  return Math.min(2, Math.max(0.6, 1 + Math.log10(Math.max(loc, 500) / 5000) * 0.5));
}

export type Estimate = {
  depth: Depth;
  runs: number;
  costRange: [number, number];
  timeRangeMinutes: [number, number];
  calibrated: boolean;
  mock: boolean;
  label: string;
};

export async function estimate(input: {
  depth: Depth;
  consensus: number;
  locs: number[];
  concurrency?: number;
}): Promise<Estimate> {
  const runs = input.locs.length * input.consensus;
  const model = env().CLAUDE_MODEL;
  const mock = env().LLM_MODE === "mock";
  const concurrency = input.concurrency ?? env().WORKER_CONCURRENCY;

  const recent = await db.run.findMany({
    where: { depth: input.depth, status: { in: ["COMPLETED", "NEEDS_REVIEW"] }, tokensIn: { gt: 0 } },
    orderBy: { finishedAt: "desc" },
    take: 50,
    select: { costUsd: true, startedAt: true, finishedAt: true },
  });
  const calibrated = recent.length >= 3;

  const p = PRIOR[input.depth];
  let cost = 0;
  let minutes = 0;
  if (calibrated) {
    const avgCost = recent.reduce((n, r) => n + Number(r.costUsd), 0) / recent.length;
    const avgMin =
      recent.reduce(
        (n, r) => n + ((r.finishedAt?.getTime() ?? 0) - (r.startedAt?.getTime() ?? 0)) / 60000,
        0,
      ) / recent.length;
    cost = avgCost * runs;
    minutes = Math.max(0.5, avgMin) * runs;
  } else {
    for (const loc of input.locs) {
      const f = sizeFactor(loc);
      const inTok = p.input * f;
      cost +=
        costUsd(model, {
          input: inTok * (1 - CACHED_SHARE),
          cacheRead: inTok * CACHED_SHARE,
          cacheWrite: 15_000,
          output: p.output * f,
        }) * input.consensus;
      minutes += p.minutes * f * input.consensus;
    }
  }
  const wall = minutes / Math.max(1, Math.min(concurrency, runs || 1));
  const costRange: [number, number] = mock ? [0, 0] : [round2(cost * 0.7), round2(cost * 1.3)];
  const timeRangeMinutes: [number, number] = [
    Math.max(1, Math.round(wall * 0.7)),
    Math.max(1, Math.round(wall * 1.4)),
  ];
  const label = mock
    ? `$0 (mock mode) · ~${timeRangeMinutes[1]} min`
    : `≈ $${fmt(costRange[0])}–${fmt(costRange[1])}, ~${timeRangeMinutes[0]}–${timeRangeMinutes[1]} min with concurrency ${concurrency}`;
  return { depth: input.depth, runs, costRange, timeRangeMinutes, calibrated, mock, label };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => (n < 10 ? n.toFixed(2) : Math.round(n).toString());

export const DEPTHS = Object.keys(DEPTH_PRESETS) as Depth[];

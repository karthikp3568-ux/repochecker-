import { describe, expect, it } from "vitest";
import { addUsage, costUsd, ZERO_USAGE } from "./pricing";

describe("pricing", () => {
  it("prices all four token kinds", () => {
    const u = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 };
    expect(costUsd("claude-opus-5-5", u)).toBeCloseTo(4 + 20 + 0.2 + 5);
  });

  it("falls back to default model pricing", () => {
    expect(costUsd("unknown", { ...ZERO_USAGE, input: 1e6 })).toBeCloseTo(4);
  });

  it("adds usage", () => {
    expect(addUsage({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, ZERO_USAGE)).toEqual({
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
    });
  });
});

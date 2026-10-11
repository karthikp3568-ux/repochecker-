import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMockClient, registerMock } from "./mock";

describe("mock LLM client", () => {
  const schema = z.object({ answer: z.string() });

  it("returns schema-validated canned output with zero usage", async () => {
    registerMock("compare", () => ({ answer: "A ranks higher" }));
    const res = await createMockClient().structured({
      task: "compare",
      system: "s",
      user: "u",
      schema,
      effort: "medium",
    });
    expect(res.data.answer).toBe("A ranks higher");
    expect(res.usage.input + res.usage.output).toBe(0);
  });

  it("rejects canned output that violates the schema", async () => {
    registerMock("verify", () => ({ wrong: 1 }));
    await expect(
      createMockClient().structured({ task: "verify", system: "s", user: "u", schema, effort: "medium" }),
    ).rejects.toThrow();
  });
});

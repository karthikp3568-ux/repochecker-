import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyRubric, type Criterion } from "../rubric/schema";
import { checkCompleteness, verifyEvidence } from "./verify";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "rj-verify-"));
  await mkdir(path.join(root, "src"));
  await writeFile(
    path.join(root, "src/app.py"),
    [
      "import os",
      "",
      "def handler(event):",
      "    user = event['user']",
      "    return    {'ok': True,",
      "            'user': user}",
      "",
      "# end",
    ].join("\n"),
  );
});
afterAll(() => rm(root, { recursive: true, force: true }));

const read = new Set(["src/app.py"]);

describe("verifyEvidence", () => {
  it("accepts exact and whitespace-normalized quotes within tolerance", async () => {
    const [a, b, c] = await verifyEvidence(
      root,
      [
        {
          path: "src/app.py",
          startLine: 3,
          endLine: 4,
          quote: "def handler(event):\n    user = event['user']",
        },
        { path: "src/app.py", startLine: 5, endLine: 6, quote: "return {'ok': True, 'user': user}" },
        { path: "./src/app.py", startLine: 1, endLine: 1, quote: "def handler(event):" }, // 2 lines off, within ±3
      ],
      read,
    );
    expect([a!.verified, b!.verified, c!.verified]).toEqual([true, true, true]);
  });

  it("rejects fabricated quotes, bad ranges, missing files and unread files", async () => {
    const out = await verifyEvidence(
      root,
      [
        { path: "src/app.py", startLine: 3, endLine: 4, quote: "def other_function():" },
        { path: "src/app.py", startLine: 40, endLine: 41, quote: "import os" },
        { path: "src/missing.py", startLine: 1, endLine: 1, quote: "x" },
        { path: "../etc/passwd", startLine: 1, endLine: 1, quote: "root" },
        { path: "src/app.py", startLine: 1, endLine: 1, quote: "import os" },
      ],
      new Set(["other.py"]),
    );
    expect(out.map((o) => o.verified)).toEqual([false, false, false, false, false]);
    expect(out[0]!.reason).toMatch(/never read/); // unread check happens before quote check
    expect(out[1]!.reason).toMatch(/outside/);
    expect(out[2]!.reason).toMatch(/not found/i);
  });

  it("rejects quotes far outside the tolerance window", async () => {
    const [r] = await verifyEvidence(
      root,
      [{ path: "src/app.py", startLine: 8, endLine: 8, quote: "import os" }],
      read,
    );
    expect(r!.verified).toBe(false);
    expect(r!.reason).toMatch(/Quote not found/);
  });
});

describe("checkCompleteness", () => {
  const anchors = Array.from({ length: 5 }, () => ({ band: "x", description: "y" }));
  const crit = (id: string, over: Partial<Criterion> = {}): Criterion => ({
    id,
    name: id,
    description: "",
    lookFor: [],
    boundary: null,
    anchors,
    weight: 50,
    weightReasoning: "",
    type: "scored",
    gateConfig: null,
    bonusMax: null,
    scorer: "ai",
    assessability: "static",
    assessabilityNote: null,
    suggested: false,
    suggestionReason: null,
    ...over,
  });
  const rubric = {
    ...emptyRubric(),
    criteria: [crit("a"), crit("g", { type: "gate", weight: 0 }), crit("h", { scorer: "human" })],
  };

  it("flags missing, out-of-range and wrong gate statuses; ignores human criteria", () => {
    const r = checkCompleteness(rubric, [
      { criterionId: "a", status: "scored", score: 11 },
      { criterionId: "g", status: "scored", score: 5 },
    ]);
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.problems).toHaveLength(2);
    expect(checkCompleteness(rubric, [{ criterionId: "a", status: "scored", score: 7 }]).missing).toEqual([
      "g",
    ]);
    expect(
      checkCompleteness(rubric, [
        { criterionId: "a", status: "insufficient_evidence", score: null },
        { criterionId: "g", status: "gate_pass", score: null },
      ]).complete,
    ).toBe(true);
  });
});

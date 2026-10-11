import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as approveRoute from "@/app/api/reports/[id]/approve/route";
import * as overridesRoute from "@/app/api/reports/[id]/overrides/route";
import * as reportRoute from "@/app/api/reports/[id]/route";
import * as shareRoute from "@/app/api/reports/[id]/share/route";
import * as evaluationRoute from "@/app/api/evaluations/[id]/route";
import * as evaluationsRoute from "@/app/api/evaluations/route";
import * as exportRoute from "@/app/api/evaluations/[id]/export/route";
import * as leaderboardRoute from "@/app/api/evaluations/[id]/leaderboard/route";
import * as membersRoute from "@/app/api/evaluations/[id]/members/route";
import * as answersRoute from "@/app/api/evaluations/[id]/rubric/answers/route";
import * as draftRoute from "@/app/api/evaluations/[id]/rubric/draft/route";
import * as lockRoute from "@/app/api/evaluations/[id]/rubric/lock/route";
import * as runsRoute from "@/app/api/evaluations/[id]/runs/route";
import * as uploadRoute from "@/app/api/evaluations/[id]/submissions/upload/route";
import { db } from "@/lib/db";
import { zipDirectory } from "@/lib/ingest/zip-write";
import { processRun } from "@/worker/pipeline";
import { call, session } from "./helpers";

type TestUser = { id: string; email: string };
let owner: TestUser;
let outsider: TestUser;
let viewer: TestUser;
const mk = async (email: string, name: string): Promise<TestUser> => ({
  id: (await db.user.create({ data: { email, name } })).id,
  email,
});
let evaluationId: string;
const as = (u: TestUser | null) => (session.user = u);

beforeAll(async () => {
  owner = await mk("owner@test.local", "Owner");
  outsider = await mk("outsider@test.local", "Outsider");
  viewer = await mk("viewer@test.local", "Viewer");
});

describe("auth and evaluations", () => {
  it("rejects unauthenticated requests with a JSON error", async () => {
    as(null);
    const r = await call(evaluationsRoute.GET);
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("UNAUTHORIZED");
  });

  it("creates an evaluation and hides it from non-members", async () => {
    as(owner);
    const r = await call(evaluationsRoute.POST, {
      body: { name: "Integration", purpose: "hackathon", context: { brief: "Build anything" } },
    });
    expect(r.status).toBe(201);
    evaluationId = r.json.id;
    as(outsider);
    expect((await call(evaluationRoute.GET, { params: { id: evaluationId } })).status).toBe(404);
  });

  it("validates bodies with zod", async () => {
    as(owner);
    const r = await call(evaluationsRoute.POST, { body: { name: "", purpose: "nope" } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("rubric builder (mock LLM)", () => {
  it("asks clarifying questions for a vague intent, then builds a rubric", async () => {
    as(owner);
    const q = await call(draftRoute.POST, { params: { id: evaluationId }, body: { intent: "good code" } });
    expect(q.status).toBe(200);
    expect(q.json.mode).toBe("questions");
    const a = await call(answersRoute.POST, {
      params: { id: evaluationId },
      body: {
        answers: q.json.questions.map((x: { id: string; options: string[] }) => ({
          questionId: x.id,
          choice: x.options[0],
          freeText: null,
        })),
      },
    });
    expect(a.json.mode).toBe("rubric");
  });

  it("weights criteria by emphasis and blocks locking invalid rubrics", async () => {
    as(owner);
    const r = await call(draftRoute.POST, {
      params: { id: evaluationId },
      body: {
        intent:
          "Most important: it actually works and solves the brief. Then readable code quality. Meaningful tests matter a bit.",
      },
    });
    const rubric = r.json.rubric;
    expect(rubric.criteria.reduce((n: number, c: { weight: number }) => n + c.weight, 0)).toBe(100);
    expect(rubric.criteria[0].weight).toBeGreaterThan(rubric.criteria[2].weight);

    const bad = structuredClone(rubric);
    bad.criteria[0].weight -= 5;
    const rejected = await call(lockRoute.POST, { params: { id: evaluationId }, body: { rubric: bad } });
    expect(rejected.status).toBe(422);
    expect(rejected.json.error.code).toBe("RUBRIC_INVALID");

    const locked = await call(lockRoute.POST, { params: { id: evaluationId }, body: { rubric } });
    expect(locked.status).toBe(201);
    expect(locked.json.version).toBe(1);
  });
});

describe("submissions, grading pipeline and reports", () => {
  let reports: { reportId: string; name: string }[] = [];

  it("accepts ZIP uploads and rejects non-zip files", async () => {
    as(owner);
    const form = new FormData();
    form.set("kind", "zip");
    for (const name of ["clean-tested", "injection", "committed-secret"]) {
      const buf = await zipDirectory(path.resolve("fixtures/repos", name));
      form.append("file", new File([new Uint8Array(buf)], `${name}.zip`, { type: "application/zip" }));
    }
    const r = await call(uploadRoute.POST, { params: { id: evaluationId }, form });
    expect(r.json.created.map((c: { status: string }) => c.status)).toEqual(["ok", "ok", "ok"]);

    const bad = new FormData();
    bad.set("kind", "zip");
    bad.append("file", new File([await readFile("package.json")], "evil.zip"));
    expect((await call(uploadRoute.POST, { params: { id: evaluationId }, form: bad })).status).toBe(415);
  });

  it("grades end-to-end: evidence verified, fabricated quotes discarded, injection flagged", async () => {
    as(owner);
    const start = await call(runsRoute.POST, {
      params: { id: evaluationId },
      body: { depth: "quick", consensus: 1 },
    });
    expect(start.status).toBe(201);
    for (const id of start.json.runIds as string[]) await processRun(id);
    const runs = await db.run.findMany({ where: { id: { in: start.json.runIds } } });
    expect(runs.every((r) => r.status === "COMPLETED" || r.status === "NEEDS_REVIEW")).toBe(true);

    const evidence = await db.evidence.findMany({
      where: { criterionScore: { runId: { in: start.json.runIds } } },
    });
    expect(evidence.filter((e) => e.verified).length).toBeGreaterThan(10);
    expect(evidence.filter((e) => !e.verified).every((e) => e.quote.includes("thisQuoteDoesNotExist"))).toBe(
      true,
    );

    const flags = await db.integrityFlag.findMany({ where: { runId: { in: start.json.runIds } } });
    expect(flags.some((f) => f.category === "prompt_injection" && f.severity === "high")).toBe(true);
    expect(flags.some((f) => f.category === "secret")).toBe(true);
    expect(flags.every((f) => !f.description.includes("FAKE0000demo1234567890"))).toBe(true);

    const lb = await call(leaderboardRoute.GET, { params: { id: evaluationId } });
    reports = lb.json.ranked.map((e: { reportId: string; name: string }) => ({
      reportId: e.reportId,
      name: e.name,
    }));
    expect(reports.length).toBe(3);
  });

  it("applies overrides with an audit trail and recomputes the final score", async () => {
    as(owner);
    const reportId = reports[0]!.reportId;
    const before = await call(reportRoute.GET, { params: { id: reportId } });
    const crit = before.json.criteria.find((c: { type: string }) => c.type === "scored");
    const r = await call(overridesRoute.POST, {
      params: { id: reportId },
      body: {
        criterionId: crit.id,
        newScore: crit.score === 10 ? 0 : 10,
        reason: "Verified by running it locally.",
      },
    });
    expect(r.status).toBe(200);
    const after = await call(reportRoute.GET, { params: { id: reportId } });
    expect(after.json.score.final).not.toBe(before.json.score.final);
    expect(after.json.score.ai).toBe(before.json.score.ai);
    const audit = await db.scoreOverride.findMany({ where: { reportId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.reason).toMatch(/running it locally/);
  });

  it("enforces roles: viewers can read but not override or approve", async () => {
    as(owner);
    await call(membersRoute.POST, {
      params: { id: evaluationId },
      body: { email: viewer.email, role: "viewer" },
    });
    as(viewer);
    const reportId = reports[0]!.reportId;
    expect((await call(reportRoute.GET, { params: { id: reportId } })).status).toBe(200);
    expect((await call(approveRoute.POST, { params: { id: reportId }, body: {} })).status).toBe(403);
    const crit = (await db.report.findUniqueOrThrow({ where: { id: reportId } })).criteria as {
      criterionId: string;
    }[];
    expect(
      (
        await call(overridesRoute.POST, {
          params: { id: reportId },
          body: { criterionId: crit[0]!.criterionId, newScore: 1, reason: "nope nope" },
        })
      ).status,
    ).toBe(403);
  });

  it("approves, shares with a ≥128-bit token, and exports CSV", async () => {
    as(owner);
    const reportId = reports[0]!.reportId;
    expect((await call(approveRoute.POST, { params: { id: reportId }, body: {} })).status).toBe(200);
    const share = await call(shareRoute.POST, {
      params: { id: reportId },
      body: { hideComments: true, hideOverrides: true },
    });
    expect(Buffer.from(share.json.shareToken, "base64url").length).toBeGreaterThanOrEqual(16);
    const csv = await call(exportRoute.GET, {
      params: { id: evaluationId },
      url: `http://localhost/api/x?format=csv`,
    });
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(String(csv.json).split("\r\n")[0]).toMatch(/^rank,tied,name/);
  });
});

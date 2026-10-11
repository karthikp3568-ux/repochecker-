import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanRel, listDir, readFileLines, resolveInside, searchCode } from "./fs-tools";

let root: string;
let outside: string;

beforeAll(async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "rj-tools-"));
  root = path.join(base, "repo");
  outside = path.join(base, "secret.txt");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "node_modules/x"), { recursive: true });
  await writeFile(outside, "TOP SECRET");
  await writeFile(
    path.join(root, "src/a.ts"),
    Array.from({ length: 700 }, (_, i) => `line ${i + 1}`).join("\n"),
  );
  await writeFile(path.join(root, "src/key.ts"), `const k = "sk_live_${"4eC39HqLyjWDarjtT1zdp7dc"}";\n`);
  await writeFile(path.join(root, "bin.dat"), Buffer.from([1, 0, 2, 3]));
  await writeFile(path.join(root, "node_modules/x/index.js"), "needle");
  await writeFile(path.join(root, "src/b.ts"), "export const needle = 1;\n");
  try {
    await symlink(outside, path.join(root, "escape.txt"));
  } catch {
    // Symlinks may need privileges on Windows; the escape test is skipped then.
  }
});
afterAll(() => rm(path.dirname(root), { recursive: true, force: true }));

describe("path confinement", () => {
  it("rejects traversal and drive letters", async () => {
    expect(() => cleanRel("../x")).toThrow();
    expect(() => cleanRel("src/../../x")).toThrow();
    expect(() => cleanRel("C:/Windows")).toThrow();
    expect(cleanRel("/src/a.ts")).toBe("src/a.ts");
    await expect(resolveInside(root, "../secret.txt")).rejects.toThrow();
  });

  it("rejects symlinks that point outside the root", async () => {
    const exists = await resolveInside(root, "escape.txt").then(
      () => "resolved",
      (e: Error) => e.message,
    );
    expect(exists === "resolved").toBe(false);
  });
});

describe("read_file", () => {
  it("returns numbered lines capped at 600", async () => {
    const r = await readFileLines(root, "src/a.ts");
    expect(r.startLine).toBe(1);
    expect(r.endLine).toBe(600);
    expect(r.text).toContain("600  line 600");
    expect(r.text).toContain("startLine=601");
  });
  it("reads ranges", async () => {
    const r = await readFileLines(root, "src/a.ts", 650, 660);
    expect(r.text).toContain("655  line 655");
    expect(r.endLine).toBe(660);
  });
  it("refuses binaries and redacts secrets", async () => {
    await expect(readFileLines(root, "bin.dat")).rejects.toThrow(/binary/);
    const r = await readFileLines(root, "src/key.ts");
    expect(r.text).not.toContain("4eC39HqLyjWDarjtT1zdp7dc");
    expect(r.text).toContain("redacted");
  });
});

describe("list_dir and search_code", () => {
  it("marks excluded dirs", async () => {
    const out = await listDir(root, ".", 2);
    expect(out).toContain("node_modules/  (excluded");
    expect(out).toContain("a.ts  700 lines");
  });
  it("searches source but not vendored code", async () => {
    const r = await searchCode(root, "needle");
    expect(r.hits.map((h) => h.path)).toEqual(["src/b.ts"]);
    expect(r.text).toContain("src/b.ts:1:");
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalStorage } from "./local";

describe("LocalStorage", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rj-storage-"));
  const s = new LocalStorage(dir);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("puts, gets, checks and deletes", async () => {
    await s.put("a/b.txt", "hi");
    expect(await s.exists("a/b.txt")).toBe(true);
    expect((await s.get("a/b.txt")).toString()).toBe("hi");
    await s.delete("a/b.txt");
    expect(await s.exists("a/b.txt")).toBe(false);
  });

  it("rejects keys that escape the root", () => {
    expect(() => s.localPath("../evil")).toThrow(/escapes/);
    expect(() => s.localPath(path.resolve("/etc/passwd"))).toThrow(/escapes/);
  });
});

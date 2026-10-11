import { describe, expect, it } from "vitest";
import { authArgs, parseRepoUrl } from "./git";

describe("parseRepoUrl", () => {
  it("normalizes GitHub forms to one source key", () => {
    const keys = [
      "https://github.com/Vercel/Next.js",
      "https://github.com/vercel/next.js.git",
      "git@github.com:vercel/next.js.git",
      "vercel/next.js",
      "https://github.com/vercel/next.js/",
    ].map((u) => parseRepoUrl(u).sourceKey);
    expect(new Set(keys)).toEqual(new Set(["github:vercel/next.js"]));
  });

  it("extracts a branch from /tree/ URLs", () => {
    const p = parseRepoUrl("https://github.com/a/b/tree/feature/x");
    expect(p.branch).toBe("feature/x");
    expect(p.url).toBe("https://github.com/a/b");
  });

  it("accepts generic https git hosts", () => {
    expect(parseRepoUrl("https://gitlab.com/group/proj.git").sourceType).toBe("git");
  });

  it("rejects credentials, private hosts and other protocols", () => {
    expect(() => parseRepoUrl("https://user:pass@gitlab.com/a/b")).toThrow(/credentials/);
    expect(() => parseRepoUrl("http://localhost:3000/x/y")).toThrow(/Private/);
    expect(() => parseRepoUrl("file:///etc/passwd")).toThrow();
    expect(() => parseRepoUrl("not a url")).toThrow();
  });
});

describe("authArgs", () => {
  it("passes the token as a header, never in the URL", () => {
    const args = authArgs("tok123");
    expect(args.join(" ")).not.toContain("tok123");
    expect(args[1]).toMatch(/^http\.extraHeader=Authorization: Basic /);
    expect(authArgs(null)).toEqual([]);
  });
});

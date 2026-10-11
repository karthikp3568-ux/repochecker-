import { describe, expect, it } from "vitest";
import { containerName, dockerRunArgs, shellQuote, tail } from "./docker";

describe("dockerRunArgs", () => {
  const base = {
    name: "rj-x",
    workDir: "/data/sandbox/x",
    image: "repojudge-sandbox:latest",
    command: ["sh", "-lc", "npm test"],
  };

  it("applies the spec's resource limits and hardening", () => {
    const args = dockerRunArgs({ ...base, network: "none" }).join(" ");
    for (const flag of [
      "--network none",
      "--cpus 2",
      "--memory 2g",
      "--pids-limit 256",
      "--user 1000:1000",
      "--read-only",
      "--cap-drop ALL",
      "--security-opt no-new-privileges",
    ]) {
      expect(args).toContain(flag);
    }
    expect(args).not.toMatch(/docker\.sock/);
    expect(args).toContain("-v /data/sandbox/x:/work:rw");
  });

  it("allows network only when asked (install phase)", () => {
    expect(dockerRunArgs({ ...base, network: "bridge" }).join(" ")).toContain("--network bridge");
  });
});

describe("helpers", () => {
  it("keeps only the last lines and redacts secrets", () => {
    const text =
      Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n") +
      `\nkey sk_live_${"4eC39HqLyjWDarjtT1zdp7dc"}`;
    const t = tail(text, 200);
    expect(t.split("\n")).toHaveLength(200);
    expect(t).not.toContain("4eC39HqLyjWDarjtT1zdp7dc");
  });
  it("quotes shell arguments", () => {
    expect(shellQuote("a b'c")).toBe(`'a b'\\''c'`);
    expect(containerName("CmvAbc_1")).toBe("rj-cmvabc_1");
  });
});

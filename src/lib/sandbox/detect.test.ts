import { describe, expect, it } from "vitest";
import type { RepoFacts } from "../ingest/index";
import { detectCommands } from "./detect";

const facts = (manifests: RepoFacts["manifests"], testFiles = 1) =>
  ({
    manifests,
    tests: { files: testFiles, frameworks: [], testToSourceLocRatio: 0 },
  }) as unknown as RepoFacts;

describe("detectCommands", () => {
  it("plans npm install/build/test/lint from the root package.json and lockfile", () => {
    const cmds = detectCommands(
      facts([
        {
          path: "package.json",
          kind: "npm",
          dependencyCount: 3,
          scripts: { build: "tsc", test: "vitest run", lint: "eslint ." },
        },
        { path: "examples/demo/package.json", kind: "npm", dependencyCount: 1, scripts: { test: "x" } },
      ]),
      new Set(["package.json", "package-lock.json"]),
    );
    expect(cmds.map((c) => `${c.phase}:${c.command}:${c.cwd}`)).toEqual([
      "install:npm ci --no-audit --no-fund:.",
      "build:npm run build --silent:.",
      "test:npm test --silent:.",
      "lint:npm run lint --silent:.",
    ]);
  });

  it("skips npm's placeholder test script", () => {
    const cmds = detectCommands(
      facts([
        {
          path: "package.json",
          kind: "npm",
          dependencyCount: 0,
          scripts: { test: 'echo "Error: no test specified" && exit 1' },
        },
      ]),
      new Set(),
    );
    expect(cmds.map((c) => c.phase)).toEqual(["install"]);
  });

  it("plans python with a venv and pytest only when tests exist", () => {
    const withTests = detectCommands(
      facts([{ path: "requirements.txt", kind: "pip", dependencyCount: 1 }]),
      new Set(),
    );
    expect(withTests.map((c) => c.phase)).toEqual(["install", "test"]);
    expect(withTests[0]!.command).toContain("pip install -q -r requirements.txt");
    const noTests = detectCommands(
      facts([{ path: "pyproject.toml", kind: "pyproject.toml", dependencyCount: 1 }], 0),
      new Set(),
    );
    expect(noTests.map((c) => c.phase)).toEqual(["install"]);
  });

  it("plans go and cargo", () => {
    expect(
      detectCommands(facts([{ path: "go.mod", kind: "go", dependencyCount: 1 }]), new Set()).map(
        (c) => c.command,
      ),
    ).toEqual(["go mod download", "go build ./...", "go test ./...", "go vet ./..."]);
    expect(
      detectCommands(facts([{ path: "Cargo.toml", kind: "cargo", dependencyCount: 1 }]), new Set()).map(
        (c) => c.phase,
      ),
    ).toEqual(["install", "build", "test"]);
  });
});

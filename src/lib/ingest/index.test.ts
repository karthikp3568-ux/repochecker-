import { describe, expect, it } from "vitest";
import { isTestPath, languageOf, pythonDeps } from "./index";

describe("pythonDeps", () => {
  it("reads PEP 621 dependency arrays, not every key", () => {
    const toml =
      '[project]\nname = "x"\nversion = "1"\ndependencies = [\n  "click>=8",\n  "rich",\n]\n[tool.ruff]\nline-length = 100\n';
    expect(pythonDeps("pyproject.toml", toml)).toHaveLength(2);
  });
  it("reads poetry sections and skips python itself", () => {
    const toml =
      '[tool.poetry.dependencies]\npython = "^3.11"\nrequests = "^2"\nflask = "*"\n[build-system]\nrequires = ["poetry-core"]\n';
    expect(pythonDeps("pyproject.toml", toml)).toHaveLength(2);
  });
  it("reads requirements.txt", () => {
    expect(pythonDeps("requirements.txt", "# c\nflask==3\n-r other.txt\nrequests\n")).toHaveLength(2);
  });
});

describe("classification", () => {
  it("detects languages and test paths", () => {
    expect(languageOf("src/a.tsx")).toBe("TypeScript");
    expect(languageOf("Dockerfile")).toBe("Dockerfile");
    expect(isTestPath("tests/test_api.py")).toBe(true);
    expect(isTestPath("pkg/flag_test.go")).toBe(true);
    expect(isTestPath("src/user.spec.ts")).toBe(true);
    expect(isTestPath("test.js")).toBe(true);
    expect(isTestPath("src/contest.ts")).toBe(false);
    expect(isTestPath("latest.js")).toBe(false);
  });
});

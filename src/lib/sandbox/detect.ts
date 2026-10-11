/**
 * Detect install/build/test/lint commands from manifests (spec §9). Only the shallowest
 * manifest of each kind is used (the project root, not nested examples or fixtures).
 */
import type { RepoFacts } from "../ingest/index";

export type PlannedCommand = { phase: "install" | "build" | "test" | "lint"; command: string; cwd: string };

const DEFAULT_NPM_TEST = /no test specified/i;

function shallowest<T extends { path: string }>(items: T[]): T | undefined {
  return [...items].sort(
    (a, b) => a.path.split("/").length - b.path.split("/").length || a.path.length - b.path.length,
  )[0];
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");

export function detectCommands(facts: RepoFacts, files: Set<string>): PlannedCommand[] {
  const out: PlannedCommand[] = [];
  const has = (p: string) => files.has(p);

  const npm = shallowest(facts.manifests.filter((m) => m.kind === "npm"));
  if (npm) {
    const cwd = dirOf(npm.path);
    const at = (f: string) => (cwd === "." ? f : `${cwd}/${f}`);
    const install = has(at("pnpm-lock.yaml"))
      ? "npx -y pnpm@9 install --frozen-lockfile"
      : has(at("yarn.lock"))
        ? "npx -y yarn@1 install --frozen-lockfile --non-interactive"
        : has(at("package-lock.json"))
          ? "npm ci --no-audit --no-fund"
          : "npm install --no-audit --no-fund";
    out.push({ phase: "install", command: install, cwd });
    const s = npm.scripts ?? {};
    if (s.build) out.push({ phase: "build", command: "npm run build --silent", cwd });
    if (s.test && !DEFAULT_NPM_TEST.test(s.test))
      out.push({ phase: "test", command: "npm test --silent", cwd });
    if (s.lint) out.push({ phase: "lint", command: "npm run lint --silent", cwd });
  }

  const py = shallowest(
    facts.manifests.filter((m) => ["pip", "pyproject.toml", "setup.py", "Pipfile"].includes(m.kind)),
  );
  if (py) {
    const cwd = dirOf(py.path);
    const venv = "python3 -m venv /tmp/venv && . /tmp/venv/bin/activate";
    const install =
      py.kind === "pip"
        ? `${venv} && pip install -q -r ${py.path.split("/").pop()} pytest`
        : `${venv} && (pip install -q -e '.[dev,test]' || pip install -q -e .) && pip install -q pytest`;
    out.push({ phase: "install", command: install, cwd });
    if (facts.tests.files > 0)
      out.push({ phase: "test", command: ". /tmp/venv/bin/activate && python -m pytest -q", cwd });
  }

  const go = shallowest(facts.manifests.filter((m) => m.kind === "go"));
  if (go) {
    const cwd = dirOf(go.path);
    out.push({ phase: "install", command: "go mod download", cwd });
    out.push({ phase: "build", command: "go build ./...", cwd });
    if (facts.tests.files > 0) out.push({ phase: "test", command: "go test ./...", cwd });
    out.push({ phase: "lint", command: "go vet ./...", cwd });
  }

  const cargo = shallowest(facts.manifests.filter((m) => m.kind === "cargo"));
  if (cargo) {
    const cwd = dirOf(cargo.path);
    out.push({ phase: "install", command: "cargo fetch", cwd });
    out.push({ phase: "build", command: "cargo build --offline", cwd });
    out.push({ phase: "test", command: "cargo test --offline", cwd });
  }

  const maven = shallowest(facts.manifests.filter((m) => m.kind === "maven"));
  if (maven) {
    const cwd = dirOf(maven.path);
    out.push({ phase: "install", command: "mvn -q -B dependency:go-offline", cwd });
    out.push({ phase: "test", command: "mvn -q -B -o test", cwd });
  }

  const gradle = shallowest(facts.manifests.filter((m) => m.kind === "gradle"));
  if (gradle) {
    const cwd = dirOf(gradle.path);
    const g = has(cwd === "." ? "gradlew" : `${cwd}/gradlew`) ? "sh ./gradlew" : "gradle";
    out.push({ phase: "install", command: `${g} --no-daemon -q dependencies`, cwd });
    out.push({ phase: "test", command: `${g} --no-daemon --offline -q test`, cwd });
  }

  const order = { install: 0, build: 1, test: 2, lint: 3 } as const;
  return out.sort((a, b) => order[a.phase] - order[b.phase]);
}

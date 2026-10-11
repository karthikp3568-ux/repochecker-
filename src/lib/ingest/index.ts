import { readFile } from "node:fs/promises";
import path from "node:path";
import { gitFacts, type GitFacts } from "./git";
import {
  isCommittedEnvFile,
  scanInjection,
  scanSecrets,
  type InjectionFinding,
  type SecretFinding,
} from "./scanners";
import { walkRepo, type WalkedFile } from "./walk";

/** Deterministic description of a snapshot (spec §5.1). No LLM involved. */
export type RepoFacts = {
  repo: { url: string; commitSha: string; branch?: string };
  size: { files: number; sourceFiles: number; totalLoc: number; byLanguage: Record<string, number> };
  tree: string;
  entryPoints: string[];
  manifests: { path: string; kind: string; dependencyCount: number; scripts?: Record<string, string> }[];
  tests: { files: number; frameworks: string[]; testToSourceLocRatio: number };
  docs: { readme: string | null; readmeWords: number; license: string | null };
  ci: string[];
  hasDocker: boolean;
  excluded: { vendored: string[]; generated: string[]; binaryCount: number };
  git: GitFacts | null;
  secretFindings: SecretFinding[];
  injectionFindings: InjectionFinding[];
  readmeClaims: string[];
};

const LANG: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  ipynb: "Jupyter",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  scala: "Scala",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  fs: "F#",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  hpp: "C++",
  hh: "C++",
  swift: "Swift",
  m: "Objective-C",
  dart: "Dart",
  lua: "Lua",
  r: "R",
  jl: "Julia",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  clj: "Clojure",
  ml: "OCaml",
  sol: "Solidity",
  vue: "Vue",
  svelte: "Svelte",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "SCSS",
  less: "Less",
  sql: "SQL",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  ps1: "PowerShell",
  md: "Markdown",
  mdx: "Markdown",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  xml: "XML",
  gradle: "Gradle",
  tf: "Terraform",
};
/** Languages that count as program source (vs. config/docs). */
const NON_CODE = new Set(["Markdown", "JSON", "YAML", "TOML", "XML"]);

export function languageOf(p: string): string | null {
  const base = p.split("/").pop()!;
  if (base === "Dockerfile") return "Dockerfile";
  if (base === "Makefile") return "Makefile";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return LANG[ext] ?? null;
}

const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec|specs)\/|(\.|_)(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|(^|\/)(tests?|spec)\.[a-z]+$|_test\.go$|Tests?\.(java|kt|cs)$/i;
export const isTestPath = (p: string) => TEST_PATH.test(p);

/** Dependency names from requirements.txt / pyproject.toml / Pipfile / setup.py. */
export function pythonDeps(base: string, text: string): string[] {
  if (base === "requirements.txt") {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"));
  }
  const out: string[] = [];
  // PEP 621 / setup.py arrays: dependencies = ["x>=1", ...], install_requires=[...]
  for (const m of text.matchAll(/(?:^|\n)\s*(?:dependencies|install_requires)\s*=\s*\[([\s\S]*?)\]/g)) {
    out.push(...(m[1]!.match(/["']([A-Za-z0-9_.-]+)[^"']*["']/g) ?? []));
  }
  // Poetry / Pipfile sections: [tool.poetry.dependencies] or [packages]
  for (const m of text.matchAll(
    /^\[(?:tool\.poetry\.(?:dev-)?dependencies|packages|dev-packages)\]([\s\S]*?)(?=^\[|(?![\s\S]))/gm,
  )) {
    out.push(...(m[1]!.match(/^\s*([A-Za-z0-9_.-]+)\s*=/gm) ?? []).filter((d) => !/^\s*python\s*=/.test(d)));
  }
  return out;
}

function countDeps(obj: unknown): number {
  return obj && typeof obj === "object" ? Object.keys(obj).length : 0;
}

async function readText(root: string, rel: string, max = 200_000): Promise<string | null> {
  try {
    return (await readFile(path.join(root, rel), "utf8")).slice(0, max);
  } catch {
    return null;
  }
}

function buildTree(files: WalkedFile[], excludedDirs: string[], maxDepth = 3, maxLines = 400): string {
  type Node = {
    dirs: Map<string, Node>;
    files: { name: string; loc: number; note?: string }[];
    loc: number;
    count: number;
  };
  const mk = (): Node => ({ dirs: new Map(), files: [], loc: 0, count: 0 });
  const root = mk();
  const add = (parts: string[], leaf: { name: string; loc: number; note?: string } | null) => {
    let n = root;
    for (const p of parts) {
      if (!n.dirs.has(p)) n.dirs.set(p, mk());
      n = n.dirs.get(p)!;
      if (leaf) {
        n.loc += leaf.loc;
        n.count += 1;
      }
    }
    if (leaf) n.files.push(leaf);
  };
  for (const f of files) {
    const parts = f.path.split("/");
    const name = parts.pop()!;
    const note = f.kind === "source" ? undefined : f.kind.replace("excluded_", "");
    add(parts, { name, loc: f.lines, note });
    root.loc += f.lines;
  }
  for (const d of excludedDirs) add(d.split("/"), null);
  const excluded = new Set(excludedDirs);

  const out: string[] = [];
  const walk = (n: Node, prefix: string, depth: number, rel: string) => {
    for (const [name, child] of [...n.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (out.length >= maxLines) return;
      const childRel = rel ? `${rel}/${name}` : name;
      if (excluded.has(childRel)) {
        out.push(`${prefix}${name}/  (excluded)`);
        continue;
      }
      if (depth >= maxDepth) {
        out.push(`${prefix}${name}/  (${child.count} files, ${child.loc} LOC)`);
        continue;
      }
      out.push(`${prefix}${name}/  (${child.loc} LOC)`);
      walk(child, `${prefix}  `, depth + 1, childRel);
    }
    for (const f of n.files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= maxLines) return;
      out.push(`${prefix}${f.name}  ${f.note ? `(${f.note})` : `${f.loc}`}`);
    }
  };
  walk(root, "", 0, "");
  if (out.length >= maxLines) out.push("… (tree truncated)");
  return out.join("\n");
}

function readmeClaims(readme: string): string[] {
  const lines = readme.split(/\r?\n/);
  const claims: string[] = [];
  let inFeatures = false;
  for (const l of lines) {
    const heading = l.match(/^#{1,4}\s+(.*)/);
    if (heading) {
      inFeatures = /feature|what it does|functionality|capabilit|highlights/i.test(heading[1]!);
      continue;
    }
    const bullet = l.match(/^\s*(?:[-*+]|\d+\.)\s+(.{6,200})$/);
    if (bullet && inFeatures) claims.push(bullet[1]!.replace(/\*\*|__|`/g, "").trim());
  }
  if (claims.length === 0) {
    for (const l of lines) {
      const b = l.match(/^\s*[-*+]\s+(.{10,200})$/);
      if (
        b &&
        /\b(support|allow|let|enable|provide|can|feature|track|generate|detect|integrat)/i.test(b[1]!)
      ) {
        claims.push(b[1]!.replace(/\*\*|__|`/g, "").trim());
      }
    }
  }
  return claims.slice(0, 20);
}

export async function indexRepo(
  root: string,
  meta: { url: string; commitSha: string; branch?: string; deadline?: Date | null },
  limits: { maxFiles: number; maxBytes: number },
): Promise<RepoFacts> {
  const walked = await walkRepo(root, limits);
  const source = walked.files.filter((f) => f.kind === "source");
  const byLanguage: Record<string, number> = {};
  let totalLoc = 0;
  let testLoc = 0;
  let codeLoc = 0;
  const testFiles: string[] = [];
  for (const f of source) {
    const lang = languageOf(f.path);
    if (!lang) continue;
    byLanguage[lang] = (byLanguage[lang] ?? 0) + f.lines;
    totalLoc += f.lines;
    if (NON_CODE.has(lang)) continue;
    if (isTestPath(f.path)) {
      testFiles.push(f.path);
      testLoc += f.lines;
    } else codeLoc += f.lines;
  }

  // Manifests
  const manifests: RepoFacts["manifests"] = [];
  const frameworks = new Set<string>();
  const entryPoints = new Set<string>();
  const allDeps = new Set<string>();
  for (const f of walked.files) {
    const base = f.path.split("/").pop()!;
    if (base === "package.json") {
      const text = await readText(root, f.path);
      try {
        const pkg = JSON.parse(text ?? "{}");
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        Object.keys(deps).forEach((d) => allDeps.add(d));
        manifests.push({
          path: f.path,
          kind: "npm",
          dependencyCount: countDeps(pkg.dependencies) + countDeps(pkg.devDependencies),
          scripts: pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : undefined,
        });
        const dir = path.posix.dirname(f.path) === "." ? "" : `${path.posix.dirname(f.path)}/`;
        if (typeof pkg.main === "string") entryPoints.add(`${dir}${pkg.main.replace(/^\.\//, "")}`);
        for (const s of ["start", "dev", "serve"])
          if (pkg.scripts?.[s]) entryPoints.add(`${f.path} → npm run ${s}: ${pkg.scripts[s]}`);
      } catch {
        manifests.push({ path: f.path, kind: "npm", dependencyCount: 0 });
      }
    } else if (
      base === "requirements.txt" ||
      base === "Pipfile" ||
      base === "pyproject.toml" ||
      base === "setup.py"
    ) {
      const text = (await readText(root, f.path)) ?? "";
      const deps = pythonDeps(base, text);
      deps.forEach((d) =>
        allDeps.add(
          d
            .trim()
            .split(/[=<>~![ ;]/)[0]!
            .toLowerCase()
            .replace(/["']/g, ""),
        ),
      );
      manifests.push({
        path: f.path,
        kind: base === "requirements.txt" ? "pip" : base,
        dependencyCount: deps.length,
      });
    } else if (base === "go.mod") {
      const text = (await readText(root, f.path)) ?? "";
      manifests.push({
        path: f.path,
        kind: "go",
        dependencyCount: (text.match(/^\s+\S+ v[\d.]+/gm) ?? []).length,
      });
    } else if (base === "Cargo.toml") {
      const text = (await readText(root, f.path)) ?? "";
      const section = text.split(/^\[dependencies\]/m)[1]?.split(/^\[/m)[0] ?? "";
      manifests.push({
        path: f.path,
        kind: "cargo",
        dependencyCount: (section.match(/^\s*[\w-]+\s*=/gm) ?? []).length,
      });
      frameworks.add("cargo test");
    } else if (base === "pom.xml" || base === "build.gradle" || base === "build.gradle.kts") {
      const text = (await readText(root, f.path)) ?? "";
      const count =
        base === "pom.xml"
          ? (text.match(/<dependency>/g) ?? []).length
          : (text.match(/^\s*(implementation|api|testImplementation|compile)\b/gm) ?? []).length;
      if (/junit/i.test(text)) frameworks.add("JUnit");
      manifests.push({ path: f.path, kind: base === "pom.xml" ? "maven" : "gradle", dependencyCount: count });
    } else if (base === "Gemfile" || base === "composer.json" || base.endsWith(".csproj")) {
      const text = (await readText(root, f.path)) ?? "";
      const count =
        base === "Gemfile"
          ? (text.match(/^\s*gem\s/gm) ?? []).length
          : base === "composer.json"
            ? countDeps(JSON.parse(text || "{}").require)
            : (text.match(/<PackageReference/g) ?? []).length;
      manifests.push({
        path: f.path,
        kind: base === "Gemfile" ? "bundler" : base === "composer.json" ? "composer" : "nuget",
        dependencyCount: count,
      });
    }
  }

  const fw: [string, RegExp][] = [
    ["Jest", /^jest$/],
    ["Vitest", /^vitest$/],
    ["Mocha", /^mocha$/],
    ["Playwright", /^@playwright\/test$/],
    ["Cypress", /^cypress$/],
    ["pytest", /^pytest$/],
    ["React Testing Library", /^@testing-library\//],
    ["Jasmine", /^jasmine$/],
    ["AVA", /^ava$/],
    ["RSpec", /^rspec$/],
  ];
  for (const d of allDeps) for (const [name, re] of fw) if (re.test(d)) frameworks.add(name);
  if (testFiles.some((f) => f.endsWith("_test.go"))) frameworks.add("go test");
  if (testFiles.some((f) => /test_.*\.py$|_test\.py$/.test(f)) && !frameworks.has("pytest"))
    frameworks.add("unittest/pytest");

  // Entry points by convention
  const CONVENTIONAL =
    /^(?:src\/)?(?:main|index|app|server|cli|__main__)\.(?:[jt]sx?|py|go|rs|rb|java|kt|cs)$|^manage\.py$|^cmd\/[^/]+\/main\.go$|^src\/main\.rs$|^Program\.cs$|^src\/main\/java\/.+\/(?:Main|Application)\.java$/;
  for (const f of source) if (CONVENTIONAL.test(f.path)) entryPoints.add(f.path);
  const dockerfiles = walked.files.filter((f) => /(^|\/)Dockerfile(\.[\w-]+)?$/.test(f.path));
  for (const d of dockerfiles) {
    const text = (await readText(root, d.path)) ?? "";
    const cmd = text.match(/^\s*(?:CMD|ENTRYPOINT)\s+(.+)$/m)?.[1];
    if (cmd) entryPoints.add(`${d.path} → ${cmd.trim().slice(0, 120)}`);
  }
  const procfile = walked.files.find((f) => f.path === "Procfile");
  if (procfile) entryPoints.add("Procfile");

  // Docs
  const readmeFile = walked.files.find((f) => /^readme(\.(md|markdown|rst|txt))?$/i.test(f.path));
  const readme = readmeFile ? await readText(root, readmeFile.path, 20_000) : null;
  const licenseFile = walked.files.find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f.path));
  let license: string | null = null;
  if (licenseFile) {
    const head = ((await readText(root, licenseFile.path, 2000)) ?? "").toLowerCase();
    license = /mit license|permission is hereby granted/.test(head)
      ? "MIT"
      : /apache license/.test(head)
        ? "Apache-2.0"
        : /gnu general public license/.test(head)
          ? "GPL"
          : /bsd|redistribution and use in source and binary forms/.test(head)
            ? "BSD"
            : /mozilla public/.test(head)
              ? "MPL-2.0"
              : "Other";
  }

  // CI
  const ci = walked.files
    .filter((f) =>
      /^\.github\/workflows\/.+\.ya?ml$|^\.gitlab-ci\.yml$|^\.circleci\/|^Jenkinsfile$|^azure-pipelines\.yml$|^\.travis\.yml$|^bitbucket-pipelines\.yml$/.test(
        f.path,
      ),
    )
    .map((f) => f.path);

  // Scanners over every text file (source + generated/lockfiles are still scanned for secrets).
  const secretFindings: SecretFinding[] = [];
  const injectionFindings: InjectionFinding[] = [];
  for (const f of walked.files) {
    if (f.kind === "binary") continue;
    if (isCommittedEnvFile(f.path))
      secretFindings.push({ path: f.path, line: 1, kind: "committed_env_file", redacted: f.path });
    if (f.size > 1_000_000) continue;
    const text = await readText(root, f.path, 1_000_000);
    if (!text) continue;
    secretFindings.push(...scanSecrets(f.path, text));
    if (f.kind === "source") injectionFindings.push(...scanInjection(f.path, text));
  }

  return {
    repo: { url: meta.url, commitSha: meta.commitSha, ...(meta.branch ? { branch: meta.branch } : {}) },
    size: { files: walked.files.length, sourceFiles: source.length, totalLoc, byLanguage },
    tree: buildTree(walked.files, walked.excludedDirs),
    entryPoints: [...entryPoints].slice(0, 20),
    manifests,
    tests: {
      files: testFiles.length,
      frameworks: [...frameworks],
      testToSourceLocRatio: codeLoc ? Math.round((testLoc / codeLoc) * 100) / 100 : 0,
    },
    docs: { readme, readmeWords: readme ? readme.split(/\s+/).filter(Boolean).length : 0, license },
    ci,
    hasDocker:
      dockerfiles.length > 0 || walked.files.some((f) => /(^|\/)(docker-)?compose\.ya?ml$/.test(f.path)),
    excluded: {
      vendored: walked.excludedDirs.slice(0, 50),
      generated: walked.files
        .filter((f) => f.kind === "excluded_generated" || f.kind === "lockfile")
        .map((f) => f.path)
        .slice(0, 50),
      binaryCount: walked.files.filter((f) => f.kind === "binary").length,
    },
    git: await gitFacts(root, meta.commitSha, meta.deadline).catch(() => null),
    secretFindings: secretFindings.slice(0, 200),
    injectionFindings: injectionFindings.slice(0, 100),
    readmeClaims: readme ? readmeClaims(readme) : [],
  };
}

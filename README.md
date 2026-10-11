# RepoJudge

Grade code repositories against criteria **you** describe. RepoJudge turns your own words into a weighted rubric, an AI agent reads each repository and scores it with file:line evidence that is checked against the code, and humans review, override and approve.

![Report](docs/screenshots/report.png)

| Rubric editor | Leaderboard |
|---|---|
| ![Rubric editor](docs/screenshots/rubric-editor.png) | ![Leaderboard](docs/screenshots/leaderboard.png) |

- **Your criteria, not ours.** No built-in criteria. Describe what matters; the builder asks clarifying questions if needed; you edit and lock the rubric (versioned).
- **Evidence or it didn't happen.** Every score cites file + lines + a verbatim quote. Quotes are machine-verified against the pinned snapshot; anything that doesn't match is discarded.
- **Fair and consistent.** Same rubric, pinned commit SHA and byte-identical judge prompt for every repo; optional 3-pass consensus.
- **Humans have the final say.** Overrides need a reason and are audited; human-scored criteria; approval.

`REPOJUDGE_SPEC.md` is the spec, `PROGRESS.md` the build status and `DECISIONS.md` the choices made along the way.

## Requirements

- Node.js ≥ 22 (developed on 24), pnpm (`npm i -g pnpm`), git
- Postgres + Redis, either via Docker (`docker compose up -d postgres redis`) **or** the built-in Docker-free dev services: `pnpm services`
- Optional: Docker for execution mode (sandbox image)

## Setup

```bash
pnpm install                 # also generates the Prisma client
cp .env.example .env         # fill in the values below
pnpm services                # terminal 1 — Postgres :5432 + Redis :6379 (skip if using Docker)
pnpm db:deploy               # apply migrations
pnpm dev                     # terminal 2 — http://localhost:3000
pnpm worker                  # terminal 3 — grading worker (pnpm worker:dev reloads on change)
```

| Variable | Notes |
|---|---|
| `AUTH_SECRET`, `ENCRYPTION_KEY` | 32 random bytes, base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `LLM_MODE` | `mock` runs the whole app at zero API cost (deterministic canned rubric/grading). `live` needs `ANTHROPIC_API_KEY`. |
| `CLAUDE_MODEL` | Default `claude-opus-5-5`. |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth app. Set its callback URL to `${APP_URL}/api` so it serves both sign-in and the separate "Connect GitHub for private repos" flow. In development, `/login` also offers a dev login. |
| `STORAGE_DRIVER` | `local` (default) or `s3` with `S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT` / `S3_PREFIX`. |
| `ENABLE_EXECUTION` | `true` allows the Docker sandbox (build `pnpm sandbox:build` first). Off by default. |
| `WORKER_CONCURRENCY`, `MAX_REPO_MB`, `MAX_REPO_FILES` | Worker parallelism and repository limits. |

> **Windows notes:** if `pnpm install` fails in `redis-memory-server` with `EXDEV`, set `TMP`/`TEMP` to a folder on the project's drive and run `pnpm rebuild redis-memory-server`. If `next dev` runs out of memory on a busy machine, start it with `NODE_OPTIONS=--max-old-space-size=3072`.

## How it works

1. **Context → intent → (clarify) → rubric.** The rubric builder (structured output) drafts criteria with weights, 5 scoring anchors, look-for signals, boundaries and assessability. Validation (weights = 100, 5 anchors, …) is enforced in code before locking.
2. **Submissions.** GitHub/git URLs (branch resolved to a SHA, optional deadline cutoff), CSV with column mapping, ZIP upload (zip-slip and size checks), or the GitHub repo picker.
3. **Pipeline (worker).** `FETCHING → INDEXING → [EXECUTING] → GRADING → VERIFYING → SCORING`. Indexing is deterministic (RepoFacts, secret + prompt-injection scanners). Grading is an agent loop over read-only tools (`list_dir`, `read_file`, `search_code`, `git_log`, `record_score`, `record_flag`, `finish`) confined to the snapshot. Verification checks every quote; a verifier pass reviews the scores. Final scores are computed in code (`src/lib/scoring.ts`).
4. **Review.** Report with score ring, radar, scorecard, integrity flags, highlighted evidence, discarded evidence, coverage from tool logs, overrides, human scores, comments, approval, PDF (print) / JSON export and revocable share links.
5. **Compare and iterate.** Leaderboard with tie-breaks and a heatmap, side-by-side compare with an AI explanation, CSV/JSON export, rubric v2 → re-grade (snapshots reused) → rank movement between versions.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js app |
| `pnpm worker` / `worker:dev` | BullMQ grading worker (watch mode for dev) |
| `pnpm services` | Docker-free dev Postgres + Redis |
| `pnpm typecheck` / `lint` / `format:check` | Static checks |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:integration` | API routes against a fresh `repojudge_test` database, mock LLM |
| `pnpm fixtures:zip` then `pnpm test:e2e` | Playwright: full flow, axe (light + dark), 360 px layout. Needs services + a worker running in mock mode. |
| `pnpm eval` | LLM eval suite over `fixtures/repos` — **costs money** (live mode). `EVAL_ALLOW_MOCK=1` dry-runs the harness. |
| `pnpm sandbox:build` / `sandbox:smoke` | Build the execution image; prove tests run offline with limits enforced (needs Docker) |
| `pnpm db:migrate` / `db:deploy` / `db:seed` | Prisma |

## Security model (summary)

Repository content is untrusted: tools are read-only and path-confined (real paths, no symlink escapes), secrets are redacted before reaching the model, UI or logs, prompt-injection text becomes an integrity flag, and the rubric/system prompt is never built from repo content. Execution happens only inside a Docker sandbox (no network after install, 2 CPU / 2 GB / 256 pids, non-root, read-only root fs). GitHub tokens are AES-256-GCM encrypted at rest; share tokens are 192-bit and revocable; every API route checks the caller's role.

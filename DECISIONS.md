# Decisions

Choices made where the spec was silent or the environment forced a deviation. Newest last.

## Phase 0

| # | Decision | Why |
|---|----------|-----|
| D1 | **Dev services without Docker**: `pnpm services` runs `embedded-postgres` (Postgres 18) and `redis-memory-server` (Memurai on Windows) on the same ports/credentials as `docker-compose.yml`. | Docker isn't installed on the dev machine; user chose npm fallbacks. `docker-compose.yml` is still the reference for other machines and production. |
| D2 | **TypeScript 6.0.3**, not 7.x. | TS 7 is the native (Go) compiler; Next.js 16's type-check/plugin integration relies on the JS compiler API. |
| D3 | **Prisma 7.10** (not the 8.0 RC tagged `latest`), with the `prisma-client` generator → `src/generated/prisma` and the `@prisma/adapter-pg` driver adapter. Datasource URL lives in `prisma.config.ts`. | Latest stable; 8.0 is a release candidate. |
| D4 | **Auth.js v5 (`next-auth@5.0.0-beta.32`)** with JWT sessions + Prisma adapter. Auth.js tables (`Account`, `Session`, `VerificationToken`, `User.emailVerified`) added beyond spec §10. | v5 is the Auth.js line for App Router. JWT sessions are required by the credentials (dev) provider. |
| D5 | Auth gating is done in the `/app` layout (`requireUser()`), not in `proxy.ts`. | Keeps Prisma/pg out of the edge-style proxy; every server action/route will also check auth itself (spec §13). |
| D6 | GitHub sign-in is only offered when `AUTH_GITHUB_ID/SECRET` are set; it requests identity scopes only. Private-repo `repo` scope will be a separate "Connect GitHub" flow (Phase 2). | Spec §8. |
| D7 | shadcn-style UI primitives (`button`, `card`, `input`, `badge`) are hand-written in `src/components/ui` instead of via the shadcn CLI. More are added per phase as needed. | Avoids interactive CLI; same code shape as shadcn. |
| D8 | Tailwind v4 CSS-first config; tokens are CSS variables in `globals.css` mapped through `@theme inline`; class-based dark mode via `next-themes` (system/light/dark toggle). | Spec §11.1. |
| D9 | LLM layer: one `LlmClient` interface (`src/lib/llm/types.ts`) with `structured()`; live impl uses `client.beta.messages.parse` + `betaZodOutputFormat`, `output_config.effort`, `cache_control` at the end of the system prompt, and the server-side refusal fallback (`server-side-fallback-2026-07-01`, `fallbacks: "default"`). Retries once on unparsable output. The mock client validates canned data against the same zod schema. | Spec §6. Beta `parse` is needed because `fallbacks` is a beta parameter. |
| D10 | Pricing table: Opus 5.5 $4/$20 in/out, cache read $0.20, cache write (5 min) $5 per MTok. | From current Anthropic model docs (claude-api skill). |
| D11 | `S3Storage` deferred to Phase 7; `STORAGE_DRIVER=s3` throws for now. `LocalStorage` confines keys to its root. | Not needed until deployment. |
| D12 | Project lives at the workspace root (`D:\codes\code checker`) with package name `repojudge`. | Folder name has a space, so it was scaffolded by hand rather than with create-next-app. |
| D13 | pnpm 12 installed via `npm i -g pnpm` (corepack couldn't write to Program Files). Build scripts are allow-listed in `pnpm-workspace.yaml`. | Environment. |
| D14 | When installing `redis-memory-server`, `TMP`/`TEMP` must be on the same drive as the project (D:), otherwise its post-install fails with `EXDEV`. | Windows cross-drive rename. |

## Phases 1–3

| # | Decision | Why |
|---|----------|-----|
| D15 | Appendices C (grader), D (verifier), E (compare) and the rest of B were **reconstructed** from the spec body (§5.2, §5.4, §11.2) because the pasted spec was truncated. | Missing source text. Replace with the originals when available. |
| D16 | LLM-facing schemas use `nullable` instead of optional fields and arrays instead of maps; the SDK strips numeric/string constraints from the wire schema and validates them client-side. | Structured-output JSON Schema limits. |
| D17 | Static instructions go in `system`, inputs in the first user message (builder/refiner/expander/verifier); grader `system` = instructions + context + rubric, byte-identical per evaluation, with `cache_control` at its end. | Prompt caching (§6). |
| D18 | Mock mode derives rubric criteria from the user's own text (clause splitting), never from a built-in list. | “No default criteria” rule (§4, §18). |
| D19 | Clone with `--filter=blob:limit=2m` instead of `blob:none`. | `blob:none` makes `git log --numstat` lazily fetch every blob, which is extremely slow; the 2 MB limit still keeps big binaries out. |
| D20 | Deadline mode resolves the commit in the FETCHING stage and re-pins `Submission.commitSha` (the original head is kept in metadata). | Needs history, which only exists after cloning. |
| D21 | Added `Run.groupId` (consensus passes of one submission), `Run.result` (finish output, review reasons), `Run.completedStage` (resume point) and `Report.criteria` (merged per-criterion results). | Consensus, resumable stages, report rendering. |
| D22 | The tool budget counts all tool calls; exploration tools stop at the budget, but record_score/record_flag/finish stay available up to a hard cap (budget + 2×criteria + 6). The 80% warning is appended to tool results rather than sent as a separate user message. | A separate user message would break tool_use/tool_result pairing in the runner. |
| D23 | Nudging restarts the tool runner with the full history plus one nudge message (at most 2). | The runner's loop ends at `end_turn`. |
| D24 | Coverage = distinct files read via read_file (FileAccess rows) / source files in RepoFacts. Searches are listed separately. | Spec: "coverage computed from logs". |
| D25 | Evidence verification also requires that the cited file was read in this run; a quote may match the redacted view of the file. | §5.4; secrets are redacted before the model sees them. |
| D26 | Postgres cluster forced to UTF-8 (`initdb --encoding=UTF8 --locale=C`). | Windows initdb defaulted to WIN1252 and rejected emoji/non-Latin text in READMEs. |
| D27 | Retry: failed/cancelled runs resume after `completedStage`; needs-review runs re-grade from INDEXING. | §14 idempotent stages. |
| D28 | Forms use controlled React state + zod instead of react-hook-form. | Fewer dependencies; equivalent validation. |

## Phases 4–7

| # | Decision | Why |
|---|----------|-----|
| D29 | Overrides and human scores are append-only; the latest row per criterion wins. Changing either clears an approval (it must be re-approved). | Audit trail (§13); approval must reflect the final numbers. |
| D30 | Approve is blocked while human-scored criteria are unscored, and for disqualified reports (override the gate first). | Human-scored criteria would otherwise be silently excluded from an "approved" score. |
| D31 | Share links: 192-bit tokens; comments and overrides hidden by default. The final score is shown either way. | §13, §11.2. |
| D32 | PDF export = a print-optimized route plus print CSS (browser "Save as PDF"), not server-side rendering. | No headless browser needed at runtime. |
| D33 | Integrity flags from the scanner and the agent at the same file/line are merged in the report (highest severity, both sources shown). | Avoids duplicate noise. |
| D34 | Ranking uses standard competition ranking ("1, 1, 3"). Entries still equal after every weight-ordered tie-break are marked tied. | §5.5 tie-break. |
| D35 | The compare explanation is cached in Redis for 7 days, keyed by report ids + their `updatedAt`. | "cached" (§11.2); invalidates when a report changes. |
| D36 | TanStack Table pinned to v8.21.3. | v9 (current latest) has a new features-based API; v8 is stable. |
| D37 | Sandbox: install runs per command with network; build/test/lint and the agent's run_command run via `docker exec` in one long-lived `--network none` container on a copy of the snapshot (the cached snapshot is never mounted). | §9 two-phase model, "same container" for run_command. |
| D38 | S3 storage keeps a local cache directory for snapshot work dirs; uploads and exports live in S3. | Agent tools need files on local disk. |
| D39 | Light-mode semantic and score colors use ~700/800 shades; highlighted evidence lines use a marker bar (no tint); snippets use Shiki `github-light-high-contrast`. | WCAG AA (axe + Lighthouse caught github-light orange at 3.5:1 and tinted keyword red at 4.3:1). |
| D40 | Every `overflow-x-auto` container is `position: relative`. | `sr-only` spans inside scroll containers were positioned against the page and widened it at 360 px. |
| D41 | The eval suite uses a fixed rubric from `fixtures/eval-rubric.json` (test data, not a product default) and processes runs in-process without enqueueing. | Reproducible eval; no race with a running dev worker. |
| D42 | Integration tests mock only auth and the queue; they use a real Postgres test DB, real Redis, the real pipeline and the mock LLM. | Covers the API surface realistically at zero cost. |

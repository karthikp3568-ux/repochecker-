# Progress

## Status: Phases 0–7 built. All checks pass in mock mode; three items need things this machine doesn't have (see "Open items").

| Check | Result |
|---|---|
| `pnpm typecheck` | ✅ |
| `pnpm lint` | ✅ 0 errors (1 informational React-compiler note on TanStack Table) |
| `pnpm format:check` | ✅ |
| `pnpm test` (unit) | ✅ 88 tests |
| `pnpm test:integration` | ✅ 10 tests (API routes + in-process pipeline, test DB, mock LLM) |
| `pnpm test:e2e` | ✅ full flow, axe light + dark (0 serious/critical), 360 px no horizontal scroll |
| `pnpm build` | ✅ |
| Lighthouse accessibility | ✅ 100 on landing, dashboard, wizard, rubric editor and report |
| `EVAL_ALLOW_MOCK=1 pnpm eval` | Harness runs end-to-end; 11/13 checks pass on mock heuristics (the two failures need a real model: spotting duplication, judging faked results as low integrity) |

### Phase summaries
- **0 Foundation:** Next.js 16, TS strict, Tailwind v4 tokens and dark mode, Auth.js (GitHub + dev login), Prisma 7, docker-compose plus Docker-free `pnpm services`, mock LLM, BullMQ worker.
- **1 Rubric builder:** wizard steps 1–4 with autosave; builder/refiner/expander; code-enforced validation; immutable versions; templates.
- **2 Ingestion:** URLs / CSV / ZIP / GitHub picker, SHA pinning and deadline mode, safe ZIP extraction, RepoFacts + scanners, snapshot cache, facts debug panel. Verified on ky (TS), itsdangerous (Python) and pflag (Go).
- **3 Grading:** run settings with estimates, queue, resumable state machine, SSE live feed, path-confined tools, live tool-runner driver + mock driver, deterministic evidence verification, verifier pass, consensus, scoring, failure handling. Fixtures 1–6 graded end-to-end.
- **4 Report & review:** full report page (score ring, radar, scorecard, flags, Shiki evidence, discarded evidence, coverage, recommendations, comments), overrides with audit trail, human scores, approve, print/PDF, JSON export, revocable share links, evaluation settings and members, account settings.
- **5 Leaderboard:** sortable heatmap leaderboard with filters, standard competition ranking with spec tie-breaks, DQ list, compare view with an AI explanation (cached), CSV/JSON export, version history and diffs, re-grade all, rank movement between versions, consensus. Verified with 10 submissions; v2 with a DQ gate re-graded all 10 reusing their snapshots.
- **6 Execution mode:** command detection (npm/pnpm/yarn, pip/pyproject, go, cargo, maven, gradle), a hardened two-phase Docker runner (network only for install; 2 CPU / 2 GB / 256 pids, non-root, read-only root fs, cap-drop ALL), an offline container shared with the agent's `run_command` (120 s), cleanup, `sandbox/Dockerfile`, and `pnpm sandbox:smoke` (Node + Python fixtures and isolation checks).
- **7 Hardening:** integration and E2E suites, eval suite, axe and 360 px passes, error/404/loading states, S3 storage driver, contrast fixes, README with screenshots.

### Open items (need things not available here)
1. **Live LLM mode is implemented but never run.** There's no `ANTHROPIC_API_KEY`. Still to do with a key: run the Phase 1 live check, `pnpm eval` (record the results here), and confirm prompt caching (`cache_read_input_tokens > 0` on the second submission; the eval prints this).
2. **The execution sandbox is unverified.** Docker isn't installed. Run `pnpm sandbox:build && pnpm sandbox:smoke`.
3. **GitHub OAuth and private repos are untested.** Needs a GitHub OAuth app (`AUTH_GITHUB_ID/SECRET`).
4. **Spec appendices B (part), C, D and E were reconstructed** because the spec was truncated (DECISIONS D15). Swap in the originals if they differ.

### Eval results
_Not recorded yet: needs a live API key (see open item 1)._

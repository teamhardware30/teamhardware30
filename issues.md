# Job Copilot — MVP Issue Backlog

## Here is the issues md file
> **Source of truth:** `Job Copilot MVP — Build Plan & Prompts` (Oct 24, 2026)
> **Repository:** [teamhardware30/teamhardware30](https://github.com/teamhardware30/teamhardware30)
> **Original audit baseline:** `0bd43de` — "Scaffold Job Copilot NestJS app with auth, users, and profiles"
> **Current audit:** `1c1de83` on `dev`, after fast-forwarding `dev` to `master`
> **Re-audited:** 2026-10-25 against Prompts 1–4

This file converts the build plan into an ordered, testable issue backlog. Every task needed to reach the MVP acceptance criteria is listed. Issues are written so they can be copied directly into GitHub Issues (title, labels, milestone, body, acceptance criteria).

---

## 1. How to use this backlog

- Work top-to-bottom within an epic; epics are ordered by dependency, not just calendar week.
- **P0** = blocks the critical path. **P1** = required for MVP. **P2** = polish / should-have.
- Sizes: **S** ≤ 0.5 day · **M** 1–2 days · **L** 3–4 days · **XL** 5+ days.
- Each issue has a **Done when** list. Do not close an issue until every box is checked and tests pass.
- Commit per issue (or per small group) and keep `main` green.
- Update this file as issues are completed: change `❌` to `🟡` when started and `✅` when done.

**Status legend:** ✅ Done · 🟡 Partial · ❌ Not started · ⛔ Blocked

---

## 2. Current state audit

Re-audited on 2026-10-25 at `1c1de83` after merging `master` into `dev`. The repository now has working slices for auth, resume ingestion/parsing, crawling, job pages, and crawler administration. It is not yet an end-to-end MVP. Several narrow Prompt 1–4 requirements are implemented and tested, but no whole JC issue in that range met every **Done when** criterion, so this audit does not promote any of them to ✅.

| Area | State | What exists now | What is missing or not proven |
|---|---|---|---|
| App scaffold | 🟡 Partial | NestJS 11 + Express, strict TypeScript, web/worker entrypoints, Nunjucks, Tailwind build, Redis sessions, CSRF, Zod config, Drizzle, README | Docker Compose, complete scripts, worker-only processors, `/healthz`, Helmet/CSP, compression, pino, ping queue, Bull Board, lint/format config, CI |
| Auth | 🟡 Partial | Argon2 local auth, email verification, Google/LinkedIn strategies, Redis throttling, guards, CSRF, auth e2e | Verified-email OAuth linking, resend verification, OAuth failure tests, safe-`next` fix, employer flows and broader guard tests |
| Profiles | 🟡 Partial | Onboarding upload/polling/retry, PDF/DOCX/ZIP ingestion, experience/education/skills basics, preferences, multiple resumes, profile e2e | Full inline CRUD/reordering, robust non-JS and 422 form flows, resume preview/download, profile-page ZIP parsing, working `/matches` destination |
| AI | 🟡 Partial | `completeJson()`, prompt rendering, 60 s request timeout, retry/repair paths, `aiCalls` logging, Voyage/none embedding provider, CV prompt/schema | Exact retry/repair semantics, complete raw-call/token/cost logging, embedding reliability/dimension checks, P1 prompt/schema conformance, AI tests |
| Database | 🟡 Partial | 17 tables, two migrations, shared `vector(1024)`, extensions and job GIN/HNSW indexes; empty-DB migration smoke passed | UUID v7/helpers, full spec alignment, profile HNSW index, match/ATS/application relations, migration-based e2e, complete seeds |
| Jobs / crawler | 🟡 Partial | Seven adapters, polite HTTP core, crawl→upsert→dedupe queues, scheduling, stale-job maintenance, source seed, search/detail pages | Reliable run finalization/error persistence, robust HTTP tests and kill switch, full freshness rules, complete filter/pipeline/performance tests; enrichment remains a no-op |
| Matching | ❌ Empty | Database placeholder only | Scoring, embeddings handoff, `/matches`, explanations, triggers and tests |
| ATS scanner | ❌ Empty | Database placeholder only | Everything |
| Applications | ❌ Empty | Database placeholder only | Everything |
| Admin | 🟡 Partial | Admin-only source controls and latest crawl-run views | Queue dashboard, health/cost metrics, full run stats/error previews, filters/pagination, positive role/action tests |
| Tests | 🟡 Partial | 22 unit tests and 17 Testcontainers e2e tests pass; adapter fixtures/MSW and migration/seed smoke checks | AiService/embedding tests, full pipeline and wizard tests, malformed/edge fixtures, OAuth/admin/IDOR coverage, Playwright, coverage and isolation |
| Ops / security | ❌ Missing | Job-detail SEO/sanitization and basic secure session settings | Production middleware/container, Sentry, ClamAV, data rights, full SEO, notifications, backups |

### 2.1 Verification performed on 2026-10-25

Environment: Node `24.19.0`, pnpm `9.14.2`, Podman Testcontainers. The project targets Node 22+, but an additional Node 22 runtime matrix run was not performed.

- `pnpm install --frozen-lockfile` — passed.
- `pnpm exec tsc --noEmit` — passed.
- `pnpm build` — passed.
- `pnpm css:build` — passed.
- `pnpm test` — **5 files, 22 tests passed**.
- `pnpm test:e2e` — **3 files, 17 tests passed** on retry. The first attempt timed out during Testcontainers setup; after the Ryuk image was available, the normal command passed.
- Checked-in migrations against an empty `pgvector/pgvector:pg16` container — both migrations applied; **17 tables**, `vector` and `pg_trgm`, and the expected job indexes were present.
- `pnpm db:seed:sources` twice against that migrated database — first run created 8 rows, second updated those rows, and the final count remained **8**.
- `pnpm lint` now passes using the project's ESLint flat configuration.
- `docker compose config` passes for the new Compose file.
- `pnpm build`, `pnpm typecheck`, `pnpm test:unit`, and `pnpm test:e2e` all pass after the implementation work.

Passing the existing suite does not prove requirements for which no tests exist. The e2e harness still uses `drizzle-kit push --force`; the separate migration smoke check above does not replace migrating in the harness.

### 2.2 Highest-priority remaining deviations

1. Worker isolation is incomplete: web and worker both import the full module graph and can register processors.
2. Prompt 1 infrastructure is incomplete: no Compose stack, production middleware, `/healthz`, ping queue, Bull Board, lint/format setup, or CI.
3. IDs still use UUID v4 defaults rather than UUID v7, and several identity/profile/job/match/ATS/application columns remain unaligned with the data model.
4. Onboarding redirects to `/matches`, but matching, ATS, and applications are not implemented.
5. Extracted resume text and structured parsed output are not persisted; parse/embedding errors are swallowed, preventing normal BullMQ retries.
6. Profile embedding normally does no work because the processor passes a profile ID to a lookup implemented by user ID; manual saves do not trigger re-embedding.
7. AI retry/repair/logging behavior does not exactly match the contract, and the CV prompt/schema do not match P1.
8. Many profile/onboarding forms are HTMX-only, and validation does not consistently re-render the originating form with preserved values and field errors.
9. Crawl completion can be finalized before all batches finish; per-item errors are not persisted, and malformed records can still produce a successful run.
10. Freshness only handles seven days unseen; expiry, dead-link checks, 45-day behavior, metrics, and tests are incomplete.
11. E2E tests use schema push rather than the checked-in migrations and lack isolation in places.
12. Documentation mentions `/api/v1`, but no such controllers or global prefix currently exist.

---

## 3. Milestones and sequencing

| Milestone | Scope | Plan phase | Gate / exit criteria |
|---|---|---|---|
| **M0 — Foundation corrections** | Fix schema deviations, tooling, Docker, CI, shell, components, migrations, seeds | Pre-week 3 | `pnpm dev` runs web + worker + CSS; migrations apply to an empty DB; lint/typecheck/tests green in CI |
| **M1 — Profile intelligence** | Real CV parsing, LinkedIn import, AI service, profile embedding, complete profile UX | Prompt 3 (week 2) | Upload a real PDF/DOCX/ZIP → parsed profile in < 3 min with editable fields |
| **M2 — Jobs ingestion** | Adapters, crawler pipeline, dedupe, jobs pages, admin sources | Prompt 4 (week 3) | 5,000+ active de-duplicated jobs from ≥ 6 sources; daily refresh |
| **M3 — Enrichment & embeddings** | Categories, LLM enrichment, canonical skills, batch embeddings | Prompt 5 (week 4) | **Gate 1:** jobs enriched, embedded, categorized; search and detail pages live |
| **M4 — Matching** | Scoring, matching pipeline, `/matches`, explanations | Prompt 6 (week 5) | Ranked matches with breakdown and explanation in < 10 s |
| **M5 — ATS scanner** | Deterministic checks, keyword analysis, LLM review, tailored CV PDF | Prompt 7 (week 6) | ATS score + gap report in < 10 s; tailored PDF downloads |
| **M6 — Apply & tracker** | Onsite/email/external apply, tracker Kanban, employer MVP | Prompt 8 (week 7) | **Gate 2:** one-click apply works end-to-end for onsite and email |
| **M7 — Hardening & launch** | Security, data rights, performance, SEO, observability, deploy, E2E | Prompt 9 (week 8) | Production deploy passes the Playwright happy path and launch checklist |

---

## 4. Epics and issues

## Epic 0 — Foundation corrections (M0)

### JC-001 · Make the scaffold runnable with documented tooling
**Priority:** P0 · **Size:** M · **Status:** 🟡 · **Depends on:** —
`area:foundation` `type:chore`

**Why:** The repo has no README, no `dev` script, and no documented setup. A new developer cannot start the app.

**Tasks**
- [ ] Add `.nvmrc` / `engines.node` = 22 and `packageManager` verification.
- [ ] Add scripts: `dev` (web + worker + CSS watch via `concurrently`), `start:web`, `start:worker`, `typecheck`, `test:unit`, `test:e2e`.
- [ ] Ensure `build` also builds CSS (`css:build`) or document the order.
- [ ] Add README: prerequisites, `pnpm install`, Docker services, env setup, migrations, seeds, `pnpm dev`, test commands, project structure.
- [ ] Keep `.env.example` complete and copy-paste runnable with the Compose defaults.
- [ ] Add a short "common problems" section (Docker not running, Redis connection, port conflicts).

**Done when**
- [ ] A clean clone reaches a working landing page by following only the README.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` all run from documented commands.

**Files:** `package.json`, `README.md`, `.env.example`, `.nvmrc`

---

### JC-002 · Add Docker Compose for local dependencies
**Priority:** P0 · **Size:** S · **Status:** ❌ · **Depends on:** JC-001
`area:foundation` `type:infra`

**Tasks**
- [ ] Add `docker-compose.yml` with `pgvector/pgvector:pg16`, `redis:7`, `mailpit`, `minio`.
- [ ] Persist Postgres/Redis/MinIO volumes; add health checks.
- [ ] Add a MinIO bucket-init service for `job-copilot-uploads`.
- [ ] Document Mailpit UI (`:8025`) and MinIO console (`:9001`) in README.
- [ ] Add `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, and local credentials to `.env.example`.

**Done when**
- [ ] `docker compose up -d` gives healthy Postgres, Redis, Mailpit, MinIO.
- [ ] The app can upload a resume to MinIO and send a verification email to Mailpit.

**Files:** `docker-compose.yml`, `README.md`, `.env.example`

---

### JC-003 · Complete configuration validation
**Priority:** P0 · **Size:** S · **Status:** 🟡 · **Depends on:** JC-002
`area:foundation` `type:feature`

**Tasks**
- [ ] Add env vars for S3 endpoint/path style, AI model IDs, embedding provider/model/key, email sender/domain, `APPLY_DAILY_LIMIT`, `SCAN_DAILY_LIMIT`, `TRUST_PROXY`, `SENTRY_DSN`, and feature flags.
- [ ] Validate production-required keys conditionally (e.g. AI key required when `NODE_ENV=production`).
- [ ] Add typed config access (`AppConfigService`) or document `ConfigService` keys.
- [ ] Make `SESSION_SECRET`/`CSRF_SECRET` fail fast in production but usable in tests.

**Done when**
- [ ] A missing production secret produces a clear boot error.
- [ ] `.env.example` documents every variable and its default.

**Files:** `src/common/config/env.schema.ts`, `.env.example`

---

### JC-004 · Align identity and profile tables with the data model
**Priority:** P0 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-003
`area:database` `type:refactor`

**Tasks**
- [ ] Change `users.role` enum to `seeker | employer | admin` and migrate default to `seeker`.
- [ ] Add UUID v7 generation (app-side helper or DB function) and use it for all IDs.
- [ ] `seeker_profiles`: add `yearsExperience`, `seniority`, `openToRelocate`, rename `remote` → `remotePref` (or document mapping), keep `salaryCurrency` default `KES`.
- [ ] `experiences`: store `bullets text[]` (keep `description` for backward compatibility if needed), `start`/`end` month precision.
- [ ] `educations`: align `start`/`end` years.
- [ ] `skills`: add `category`, `needsReview`; seed canonical names/aliases.
- [ ] `profile_skills`: add `level`, `years`.
- [ ] `resumes`: add `source` (`upload | linkedin_pdf | linkedin_zip | generated`), `parsedJson jsonb`, `parseStatus`, `parseError`.
- [ ] Add a single shared `vector(1024)` custom type and remove duplicates.
- [ ] Update relations and Drizzle query types.

**Done when**
- [ ] Schema compiles and `drizzle-kit generate` emits a migration.
- [ ] Existing auth/profile e2e tests pass after migration.
- [ ] No duplicated vector type definitions remain.

**Files:** `src/db/schema/*.ts`, `src/common/db/*` (new helper), migration

---

### JC-005 · Add the jobs-domain tables
**Priority:** P0 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-004
`area:database` `type:feature`

**Tasks**
- [ ] Add `companies` (`name`, `normalizedName`, `domain`, `logoUrl`, `atsType`).
- [ ] Add `sources` (`name`, `kind`, `baseUrl`, `config jsonb`, `cron`, `enabled`, `killSwitch`).
- [ ] Add `crawl_runs` (`sourceId`, `startedAt`, `finishedAt`, `fetched`, `created`, `updated`, `errors jsonb`).
- [ ] Add `categories` (`slug`, `name`, `parentId`, two-level tree).
- [ ] Expand `jobs` with every column in the plan: `sourceId`, `externalId`, `url`, `applyUrl`, `applyMethod` enum, `applyEmail`, `companyId`, `location`, `country`, `remoteType`, `employmentType`, `seniority`, salary min/max/currency, `postedAt`, `expiresAt`, `categoryId`, `requiredSkills[]`, `preferredSkills[]`, `fingerprint`, `embedding vector(1024)`, `searchVector`, `isActive`.
- [ ] Add `unique(sourceId, externalId)` and `unique(fingerprint)`.
- [ ] Add relations: source → jobs, company → jobs, category → jobs.

**Done when**
- [ ] All plan columns exist with sensible nullability and enums.
- [ ] Seed/inspection shows a job joined to company, source, and category.

**Files:** `src/db/schema/jobs.schema.ts`, `companies.schema.ts`, `sources.schema.ts`, `crawl-runs.schema.ts`, `categories.schema.ts`, `relations.ts`

---

### JC-006 · Align matching, ATS, applications, and AI tables
**Priority:** P0 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-005
`area:database` `type:refactor`

**Tasks**
- [ ] Rename/reshape `matches` → `job_matches` with `score 0–100`, `breakdown jsonb`, `explanation jsonb`, `status` (`new | saved | hidden | applied`), `computedAt`, unique `(profileId, jobId)`.
- [ ] `ats_scans`: `resumeId`, nullable `jobId`, `score`, `keywordHits jsonb`, `keywordGaps jsonb`, `formatIssues jsonb`, `suggestions jsonb`.
- [ ] `applications`: `resumeId`, `answers jsonb`, `channel` enum, full status enum (`draft | submitted | failed | viewed | interview | rejected | offer`), `submittedAt`, `events jsonb`, unique `(profileId, jobId)`.
- [ ] `ai_calls`: add `tokensIn`, `tokensOut`, `costUsd`, `promptName`, `success`; keep raw input/output.
- [ ] Add `application_events` or document that events live in JSONB.
- [ ] Add indexes: `(profileId, score DESC)` on `job_matches`, `(profileId, jobId)` unique on applications, `(profileId, createdAt)` on ATS scans.

**Done when**
- [ ] All plan tables/enums/constraints exist.
- [ ] Migrations apply cleanly and roll back in a scratch database.

**Files:** `src/db/schema/matches.schema.ts`, `ats-scans.schema.ts`, `applications.schema.ts`, `ai-calls.schema.ts`

---

### JC-007 · Create the first migration with extensions and performance indexes
**Priority:** P0 · **Size:** M · **Status:** 🟡 · **Depends on:** JC-004, JC-005, JC-006
`area:database` `type:infra`

**Tasks**
- [ ] Generate an initial migration from the aligned schema.
- [ ] Add `CREATE EXTENSION IF NOT EXISTS vector;` and `pg_trgm` at the top.
- [ ] Add `jobs.searchVector` as generated `tsvector` and a GIN index.
- [ ] Add GIN trigram on `jobs.title`; HNSW `vector_cosine_ops` on `jobs.embedding` and `seeker_profiles.embedding`.
- [ ] Add all unique and lookup indexes from the plan.
- [ ] Replace `drizzle-kit push` in `test/setup-e2e.ts` with `drizzle-kit migrate`.
- [ ] Add `db:reset` script for local development.

**Done when**
- [ ] `pnpm db:migrate` on an empty database creates every table, extension, and index.
- [ ] `\d jobs` shows the generated column, GIN, and HNSW indexes.
- [ ] e2e tests run migrations instead of pushing.

**Files:** `src/db/migrations/*`, `test/setup-e2e.ts`, `drizzle.config.ts`, `package.json`

---

### JC-008 · Add seed scripts
**Priority:** P0 · **Size:** M · **Status:** 🟡 · **Depends on:** JC-007
`area:database` `type:feature`

**Tasks**
- [ ] Add `categories.json` (~15 families, ~80 subcategories) and a seed script.
- [ ] Add a canonical skills seed with aliases (≥ 150 common tech/business skills).
- [ ] Add `sources.yaml` with starter sources disabled by default.
- [ ] Add an admin-user seed and a sample seeker/employer for local development.
- [ ] Make seeds idempotent (`onConflictDoNothing` / upsert).
- [ ] Document `pnpm db:seed` in README.

**Done when**
- [ ] Running seeds twice produces no duplicates.
- [ ] `/jobs/categories` and skill suggestions have data immediately after seeding.

**Files:** `scripts/seed.ts`, `data/categories.json`, `data/skills.json`, `data/sources.yaml`, `package.json`

---

### JC-009 · Finish the application shell and navigation
**Priority:** P1 · **Size:** M · **Status:** 🟡 · **Depends on:** JC-001
`area:web` `type:feature`

**Tasks**
- [ ] Navbar: logo, Matches, Jobs, Applications, Profile, avatar dropdown (Alpine), mobile menu.
- [ ] Add active-link styling using `currentPath` (wire it in `LocalsInterceptor`).
- [ ] Add global flash/toast area with auto-dismiss and accessible live region.
- [ ] Add footer with privacy/terms placeholders.
- [ ] Add 404, 500, and 403 pages; wire the exception filter to render them.
- [ ] Add a skip-to-content link and focus-visible styles.
- [ ] Add `<meta>` blocks for title/description/canonical.

**Done when**
- [ ] Every top-level page is reachable on mobile and desktop.
- [ ] Keyboard-only navigation works; toasts announce to screen readers.
- [ ] Unknown routes render the branded 404 page.

**Files:** `views/layouts/base.njk`, `src/common/interceptors/locals.interceptor.ts`, `views/errors/*`

---

### JC-010 · Complete the Nunjucks component library
**Priority:** P1 · **Size:** M · **Status:** 🟡 · **Depends on:** JC-009
`area:web` `type:feature`

**Tasks**
- [ ] Review and complete macros: `button`, `input`, `select`, `card`, `badge`, `modal`, `slideover`, `toast`, `score_ring`, `empty_state`, `pagination`.
- [ ] Add macros still missing: `textarea`, `checkbox`, `radio`, `alert`, `tabs` (if needed), `job_card`, `apply_button`, `step_indicator`.
- [ ] Standardize props (`variant`, `size`, `disabled`, `error`, `hx*`) and document usage in a short `views/components/README.md`.
- [ ] Ensure all form macros render labels, hints, errors, and `aria-invalid`.
- [ ] Add `score_ring` thresholds: ≥ 80 green, 60–79 amber, < 60 slate.

**Done when**
- [ ] No page uses ad-hoc Tailwind for a component that has a macro.
- [ ] Components pass a manual keyboard/screen-reader check.
- [ ] Score ring renders correct colors for 59/60/79/80.

**Files:** `views/components/*.njk`, `views/components/README.md`

---

### JC-011 · Wire production middleware, health check, logging, and Bull Board
**Priority:** P0 · **Size:** M · **Status:** ❌ · **Depends on:** JC-001
`area:foundation` `type:feature`

**Tasks**
- [ ] Add `helmet` with a strict CSP that allows self-hosted HTMX/Alpine (no CDN).
- [ ] Add `compression` and static-asset cache headers.
- [ ] Add `pino-http` request logging with request IDs; redact cookies, auth headers, and CV text.
- [ ] Add `GET /healthz` checking DB and Redis with a 2 s timeout.
- [ ] Add Bull Board at `/admin/queues` behind admin auth (guard can be a TODO stub until JC-063).
- [ ] Add a sample `ping` queue and processor to prove worker wiring.
- [ ] Ensure `worker.ts` boots only queue processors/schedulers (no HTTP controllers).
- [ ] Add graceful shutdown for DB, Redis, and BullMQ.

**Done when**
- [ ] `/healthz` returns 200 when dependencies are up and 503 when Redis is down.
- [ ] CSP blocks inline scripts except nonce'd ones.
- [ ] A ping job enqueued from the web process is processed by the worker and visible in Bull Board.

**Files:** `src/bootstrap.ts`, `src/worker.ts`, `src/common/logging/*`, `src/modules/admin/*`, `package.json`

---

### JC-012 · Set up linting, formatting, type checking, and CI
**Priority:** P0 · **Size:** M · **Status:** ❌ · **Depends on:** JC-001
`area:infra` `type:chore`

**Tasks**
- [ ] Add ESLint flat config (TypeScript, no `any`, import order) and Prettier.
- [ ] Add `typecheck` script (`tsc --noEmit`) and make `lint` non-mutating in CI (`lint:fix` locally).
- [ ] Add GitHub Actions: install, lint, typecheck, unit tests, e2e tests (Testcontainers), build.
- [ ] Cache pnpm store; upload test artifacts on failure.
- [ ] Add a PR template with the issue link and test checklist.
- [ ] Add `pnpm audit` (or Dependabot) to CI.

**Done when**
- [ ] CI is green on a fresh PR.
- [ ] A type error or lint error fails CI.
- [ ] e2e tests run in CI with Docker services.

**Files:** `.github/workflows/ci.yml`, `eslint.config.mjs`, `.prettierrc`, `package.json`

---

### JC-013 · Upgrade the test harness
**Priority:** P1 · **Size:** M · **Status:** 🟡 · **Depends on:** JC-012
`area:testing` `type:chore`

**Tasks**
- [ ] Add test factories/builders for users, profiles, jobs, applications.
- [ ] Add MSW server setup and shared fixtures directory.
- [ ] Add a mocked AI provider fixture (success, invalid JSON, timeout, 429).
- [ ] Add DB cleanup between e2e tests (truncate tables) or isolated schemas.
- [ ] Add coverage thresholds for `src/modules/**/**.service.ts` and scoring/checks utilities.
- [ ] Document how to run a single test and update fixtures.

**Done when**
- [ ] Tests do not depend on execution order.
- [ ] A new feature can reuse factories and MSW handlers without custom setup.
- [ ] Coverage report is produced locally and in CI.

**Files:** `test/factories/*`, `test/msw/*`, `test/fixtures/*`, `vitest.config*.ts`

---

## Epic 1 — Auth completion, CV parsing, LinkedIn import, and AI (M1)

### JC-014 · Finish auth edge cases and add OAuth tests
**Priority:** P1 · **Size:** M · **Status:** 🟡 · **Depends on:** JC-004
`area:auth` `type:feature`

**Tasks**
- [ ] Add "resend verification email" endpoint with throttling and a neutral response.
- [ ] Handle OAuth failures (denied consent, missing email) with a flash + redirect to `/login`.
- [ ] Ensure social login links by verified email without creating duplicate users.
- [ ] Add `next` validation coverage (open-redirect prevention).
- [ ] Add `RolesGuard` tests and an employer-only route stub.
- [ ] Add a verified-email guard option and document which routes require it.
- [ ] Add e2e tests for Google/LinkedIn strategies with mocked Passport profiles.
- [ ] Decide whether password reset is in MVP; if yes, implement token flow + email.

**Done when**
- [ ] OAuth account linking is covered by tests.
- [ ] Resend verification cannot be used to enumerate accounts.
- [ ] Role guard returns 403 for a seeker hitting an employer route.

**Files:** `src/modules/auth/*`, `src/modules/auth/strategies/*`, `test/auth.e2e-spec.ts`

---

### JC-015 · Finalize the onboarding wizard
**Priority:** P1 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-010, JC-014
`area:profiles` `type:feature`

**Tasks**
- [ ] Make step transitions deterministic: upload → parsing → review profile → preferences → matches.
- [ ] Poll parse status every 2 s with skeletons; stop on done/failed.
- [ ] Show friendly parse errors with a retry button and "upload a different file".
- [ ] Add back/forward navigation without losing entered data.
- [ ] Add validation for preferences (min ≤ max salary, ISO currency, at least one title).
- [ ] Guard `/onboarding` for users who already completed it (redirect to `/matches`).
- [ ] Guard `/matches` until the profile is minimally complete (or show an empty state).
- [ ] Add a skip option for users who want to fill the profile manually.
- [ ] Add e2e coverage for the full wizard and failure path.

**Done when**
- [ ] A new user reaches `/matches` in under 3 minutes with a real CV.
- [ ] Refreshing mid-wizard preserves progress.
- [ ] Parse failure never leaves the UI stuck in "Parsing…".

**Files:** `src/modules/profiles/profiles.controller.ts`, `views/profiles/*`, `test/profiles.e2e-spec.ts`

---

### JC-016 · Complete profile view/edit CRUD
**Priority:** P1 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-015
`area:profiles` `type:feature`

**Tasks**
- [ ] Inline edit headline, summary, location, remote preference, salary, currency, seniority, years of experience, relocation.
- [ ] Add/edit/delete/reorder experiences and educations with HTMX partials.
- [ ] Edit experience bullets as a tag/list input; cap length and count.
- [ ] Add/remove skills with aliases and suggestions; show `needsReview` skills differently.
- [ ] Manage multiple resumes: upload, set primary, preview/download, delete, rename.
- [ ] Add "profile completeness" indicator with links to missing sections.
- [ ] Ensure all mutations are CSRF-protected and return 422 partials on validation errors.
- [ ] Add e2e tests for each section.

**Done when**
- [ ] Every profile field can be edited without a full page reload.
- [ ] Deleting a row updates the UI and database consistently.
- [ ] A user cannot edit another user's profile (IDOR test).

**Files:** `src/modules/profiles/*`, `views/profiles/*`

---

### JC-017 · Rework `AiService` to the specified interface
**Priority:** P0 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-003
`area:ai` `type:refactor`

**Tasks**
- [ ] Implement `completeJson<T>(promptName, vars, schema)` loading `src/modules/ai/prompts/<name>.md` with `{{var}}` placeholders.
- [ ] Improve `complete()`: 60 s timeout, 3 retries with exponential backoff on 429/5xx only, one Zod repair retry, no retry on 4xx.
- [ ] Add a provider abstraction so the Anthropic SDK is imported only inside `AiModule`.
- [ ] Log `promptName`, model, tokens in/out, latency, estimated cost, success/error to `ai_calls` (including raw input/output).
- [ ] Add a content-hash cache for idempotent prompts (job enrichment, explanations).
- [ ] Add per-call token/cost budget and a daily cost counter.
- [ ] Add unit tests with a mocked client for success, invalid JSON, repair, timeout, and 5xx.

**Done when**
- [ ] No module outside `ai` imports `@anthropic-ai/sdk`.
- [ ] Prompt files can be changed without touching TypeScript.
- [ ] Failed calls are visible in `ai_calls` with enough context to debug.

**Files:** `src/modules/ai/ai.service.ts`, `src/modules/ai/ai.module.ts`, `src/modules/ai/prompts/*.md`, `src/db/schema/ai-calls.schema.ts`

---

### JC-018 · Implement `AiService.embed()` and the embedding provider
**Priority:** P0 · **Size:** M · **Status:** 🟡 · **Depends on:** JC-017
`area:ai` `type:feature`

**Tasks**
- [ ] Choose one 1024-dimension embedding model and document it.
- [ ] Implement batched `embed(texts: string[]): Promise<number[][]>` with retry, timeout, and rate limiting.
- [ ] Store provider/model/dimensions in config and validate the returned vector length.
- [ ] Add embedding cost logging and a per-day budget.
- [ ] Add a deterministic fake provider for tests.
- [ ] Document how to re-embed all data after a model change.

**Done when**
- [ ] A batch of 64 texts returns 64 vectors of length 1024.
- [ ] Wrong-dimension responses fail loudly and are logged.
- [ ] Tests never call the real provider.

**Files:** `src/modules/ai/ai.service.ts`, `src/modules/ai/embedding.provider.ts`, `src/common/config/env.schema.ts`

---

### JC-019 · Implement text extraction for PDF, DOCX, and scans
**Priority:** P0 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-017
`area:profiles` `type:feature`

**Tasks**
- [ ] Add `extractText(buffer, mime)` returning `{ text, pageCount, hasImages, likelyMultiColumn, isScanned, hasTables }`.
- [ ] PDF via `unpdf`: page count, text length, x-position heuristic for columns.
- [ ] DOCX via `mammoth`: HTML → text and table detection.
- [ ] OCR fallback via `tesseract.js` only when extracted text < 200 chars.
- [ ] Enforce a maximum page count and processing time.
- [ ] Store raw extracted text in `resumes.raw_text` before LLM parsing.
- [ ] Add unit tests with fixture PDFs/DOCX and a scanned PDF.

**Done when**
- [ ] A normal PDF yields text and correct flags.
- [ ] A scanned PDF triggers OCR and still produces text.
- [ ] A DOCX with tables sets `hasTables=true`.

**Files:** `src/modules/profiles/extract-text.ts`, `test/fixtures/resumes/*`, `package.json`

---

### JC-020 · Add the `ParsedResume` schema and CV parse prompt
**Priority:** P0 · **Size:** M · **Status:** 🟡 · **Depends on:** JC-017
`area:ai` `type:feature`

**Tasks**
- [ ] Add `ParsedResume` Zod schema exactly matching P1 (contact, headline, summary, experiences, education, skills, certifications, languages, total years, seniority).
- [ ] Add `src/modules/ai/prompts/cv_parse.md` with P1 text, `<cv>` data delimiters, and "facts only" rules.
- [ ] Add validation guards: max 40 skills, dates in `YYYY-MM`, `present` allowed, deduplication.
- [ ] Add a normalization step for links, phone, and location.
- [ ] Add fixtures: expected output for 3 representative CVs.
- [ ] Add a prompt version suffix strategy (`cv_parse.v1.md`) and document it.

**Done when**
- [ ] Prompt output always validates or triggers exactly one repair attempt.
- [ ] Skills are normalized and deduplicated.
- [ ] A CV with instruction-injection text is treated as data.

**Files:** `src/common/schemas/parsed-resume.schema.ts`, `src/modules/ai/prompts/cv_parse.md`

---

### JC-021 · Implement the real `parse-resume` processor
**Priority:** P0 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-018, JC-019, JC-020
`area:profiles` `type:feature`

**Tasks**
- [ ] Download the file from S3/MinIO using the stored key.
- [ ] Extract text and store it on the resume row.
- [ ] Call `completeJson('cv_parse', …)` and store `parsedJson`.
- [ ] In one Drizzle transaction: upsert experiences, educations, and profile skills; update headline/summary/location/seniority.
- [ ] Map skills case-insensitively to canonical skills via aliases; insert unknown skills with `needsReview=true`.
- [ ] Set `parseStatus` to `done` or `failed` with a safe error message; never leak stack traces to the UI.
- [ ] Enqueue `embed-profile` after a successful parse.
- [ ] Add BullMQ retry/backoff and a dead-letter/failed state.
- [ ] Add a retry endpoint/button for failed parses.
- [ ] Add integration tests with a mocked AI service and real DB.

**Done when**
- [ ] Uploading a fixture CV populates all profile sections.
- [ ] A transient S3/AI failure retries and eventually marks `failed` with a retry option.
- [ ] Re-parsing the same CV does not duplicate rows.

**Files:** `src/modules/profiles/parse-resume.processor.ts`, `profiles.service.ts`, `views/profiles/partials/*`

---

### JC-022 · Implement LinkedIn data-export ZIP import
**Priority:** P1 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-021
`area:profiles` `type:feature`

**Tasks**
- [ ] Accept the LinkedIn ZIP in onboarding and profile upload.
- [ ] Unzip with `yauzl` and parse `Profile.csv`, `Positions.csv`, `Education.csv`, `Skills.csv` with `csv-parse`.
- [ ] Map rows to the same upsert path as CV parsing, without an LLM call.
- [ ] Handle LinkedIn's column name variations and locale-specific dates.
- [ ] Detect missing files and return a friendly error.
- [ ] Guard against zip bombs (entry count, uncompressed size, path traversal).
- [ ] Add a fixture ZIP and tests.

**Done when**
- [ ] A real LinkedIn export imports positions, education, and skills.
- [ ] A malformed or oversized ZIP is rejected safely.
- [ ] Imported skills map to canonical skills where possible.

**Files:** `src/modules/profiles/linkedin-import.ts`, `test/fixtures/linkedin-export.zip`

---

### JC-023 · Recompute profile embeddings on save
**Priority:** P0 · **Size:** M · **Status:** 🟡 · **Depends on:** JC-018, JC-021
`area:profiles` `type:feature`

**Tasks**
- [ ] Build the embedding text: headline + desired titles + top skills + last 3 roles.
- [ ] Add an `embed-profile` queue job triggered by profile/skills/preferences changes.
- [ ] Debounce rapid edits (60 s) with a deterministic job ID per profile.
- [ ] Store the vector in `seeker_profiles.embedding` and record the model/version.
- [ ] Skip re-embedding when the text hash is unchanged.
- [ ] Enqueue matching recomputation after a successful embed.
- [ ] Add tests for text construction, hashing, and enqueue dedupe.

**Done when**
- [ ] Editing a profile updates the embedding exactly once after the debounce.
- [ ] Unchanged profiles do not call the embedding provider.
- [ ] A failed embed is retried and logged without blocking the save.

**Files:** `src/modules/profiles/profile-embedding.service.ts`, `src/modules/profiles/*.processor.ts`

---

### JC-024 · Add skill canonicalization and the review queue
**Priority:** P1 · **Size:** M · **Status:** 🟡 · **Depends on:** JC-008, JC-021
`area:profiles` `type:feature`

**Tasks**
- [ ] Implement `findOrCreateCanonicalSkill(name)` using case-insensitive name/alias matching.
- [ ] Merge duplicates and preserve aliases.
- [ ] Add an admin page/endpoint to review `needsReview` skills (approve, merge, rename).
- [ ] Improve `/skills/suggest?q=` with trigram search and alias hits.
- [ ] Backfill canonical mappings for existing skills.
- [ ] Add tests for alias matching and unknown-skill creation.

**Done when**
- [ ] "Postgres", "PostgreSQL", and "postgresql" resolve to one skill.
- [ ] Unknown skills appear in the review queue instead of polluting the canonical table.
- [ ] Suggestions return results for partial and alias queries.

**Files:** `src/modules/profiles/profiles.service.ts`, `src/modules/admin/*`, `views/admin/*`

---

## Epic 2 — Crawler and jobs (M2)

### JC-025 · Define the `SourceAdapter` contract and `JobDto`
**Priority:** P0 · **Size:** M · **Status:** 🟡 · **Depends on:** JC-005, JC-007
`area:crawler` `type:feature`

**Tasks**
- [ ] Define `SourceAdapter { fetch(source): AsyncIterable<RawItem>; normalize(raw): JobDto }`.
- [ ] Add a Zod `JobDto` with canonical fields, URL validation, salary/date coercion, and enum checks.
- [ ] Add an adapter registry keyed by `sources.kind` (`api`, `feed`, `jsonld`, `html`).
- [ ] Define a `RawItem` shape that preserves source metadata and raw payload for reprocessing.
- [ ] Add adapter-level error types (blocked, rate-limited, schema-invalid, network).
- [ ] Add unit tests for `JobDto` edge cases (missing salary, relative URLs, HTML entities).

**Done when**
- [ ] A new adapter can be added by implementing one interface and registering it.
- [ ] Invalid items are rejected without stopping the whole crawl.
- [ ] Every accepted item produces a fully valid `JobDto`.

**Files:** `src/modules/crawler/adapters/source-adapter.ts`, `src/modules/crawler/schemas/job.dto.ts`, `src/modules/crawler/adapters/registry.ts`

---

### JC-026 · Build the polite HTTP client
**Priority:** P0 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-025
`area:crawler` `type:feature`

**Tasks**
- [ ] Add an `undici` client with a 30 s timeout and max response size.
- [ ] Add `robots-parser` with robots.txt cached 24 h in Redis; skip disallowed URLs and log them.
- [ ] Add per-domain `bottleneck` limiters (default 1 req/s, configurable per source).
- [ ] Send `JobCopilotBot/0.1 (+contact email)` User-Agent.
- [ ] Add ETag/If-Modified-Since support and a 304 cache.
- [ ] Add retries with exponential backoff and jitter for 429/5xx only.
- [ ] Respect `Retry-After`.
- [ ] Add a per-source kill switch checked before every request.
- [ ] Add tests with MSW for 200, 304, 429, 403, timeout, and disallowed robots.

**Done when**
- [ ] No request is made to a disallowed path.
- [ ] Two crawls of the same unchanged page use conditional requests.
- [ ] A source kill switch stops all traffic immediately.

**Files:** `src/modules/crawler/http.ts`, `src/modules/crawler/robots.ts`

---

### JC-027 · Implement ATS board adapters
**Priority:** P0 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-026
`area:crawler` `type:feature`

**Tasks**
- [ ] Greenhouse adapter (boards API, company tokens from `source.config`).
- [ ] Lever adapter (postings API).
- [ ] Ashby adapter (posting API).
- [ ] Optionally add Workable and SmartRecruiters if their APIs are stable and allowed.
- [ ] Map each payload to `JobDto`, including location, remote type, salary when present, and apply URL.
- [ ] Derive `applyMethod` and `applyEmail` when possible.
- [ ] Add recorded fixtures and MSW tests for each adapter.
- [ ] Add pagination handling and rate-limit awareness.

**Done when**
- [ ] Each adapter returns normalized jobs from its fixture.
- [ ] Malformed items are skipped and counted in `crawl_runs.errors`.
- [ ] A seeded company board produces the expected job count.

**Files:** `src/modules/crawler/adapters/greenhouse.adapter.ts`, `lever.adapter.ts`, `ashby.adapter.ts`, `test/fixtures/crawler/*`

---

### JC-028 · Implement aggregator and feed adapters
**Priority:** P1 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-026
`area:crawler` `type:feature`

**Tasks**
- [ ] Remotive adapter (JSON API).
- [ ] Arbeitnow adapter (JSON API).
- [ ] Add optional Adzuna and Jooble adapters gated by API-key env vars.
- [ ] Add an RSS/XML `FeedAdapter` using `fast-xml-parser` for local boards.
- [ ] Document each source's terms and attribution requirements.
- [ ] Add rate limits and source-specific config.
- [ ] Add fixtures + MSW tests.

**Done when**
- [ ] At least six allowed sources are implemented and configurable.
- [ ] Disabled/missing-key sources are skipped without errors.
- [ ] Attribution requirements are captured in `sources.config`.

**Files:** `src/modules/crawler/adapters/remotive.adapter.ts`, `arbeitnow.adapter.ts`, `feed.adapter.ts`

---

### JC-029 · Implement JSON-LD and HTML adapters
**Priority:** P1 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-026
`area:crawler` `type:feature`

**Tasks**
- [ ] `JsonLdAdapter`: sitemap/listing → detail pages → `script[type="application/ld+json"]` → `JobPosting`.
- [ ] Support `JobPosting` arrays, `@graph`, and HTML-escaped JSON.
- [ ] `HtmlAdapter`: CSS selectors stored in `sources.config`, with sane defaults.
- [ ] Normalize relative URLs and strip tracking parameters.
- [ ] Sanitize description HTML before storage and derive `descriptionText`.
- [ ] Add fixtures for malformed and multi-JobPosting pages.
- [ ] Add robots.txt checks before detail fetches.

**Done when**
- [ ] A JSON-LD page yields a valid job with title, company, location, dates, and description.
- [ ] A malformed JSON-LD block is logged and skipped, not fatal.
- [ ] Selector-based HTML extraction works without code changes.

**Files:** `src/modules/crawler/adapters/jsonld.adapter.ts`, `html.adapter.ts`

---

### JC-030 · Build the crawl → upsert → dedupe pipeline
**Priority:** P0 · **Size:** XL · **Status:** 🟡 · **Depends on:** JC-027, JC-028, JC-029
`area:crawler` `type:feature`

**Tasks**
- [ ] `crawl-source` processor: creates a `crawl_runs` row, iterates adapter items, and updates counters.
- [ ] `upsert-jobs` processor: batch upsert by `(sourceId, externalId)`; update changed fields and set `lastSeenAt`.
- [ ] Compute fingerprint = SHA-1 of normalized title + company + city.
- [ ] `dedupe` processor: exact fingerprint first, then `pg_trgm` similarity > 0.9 within the same company in the last 30 days.
- [ ] On duplicate: merge useful fields, keep the canonical job, and mark the duplicate inactive.
- [ ] Enqueue `enrich-job` only for new or materially changed jobs.
- [ ] Record per-item errors in `crawl_runs.errors` with source URL and reason.
- [ ] Add idempotency tests: running the same crawl twice creates no duplicates.
- [ ] Add unit tests for normalization and fingerprinting.

**Done when**
- [ ] Two overlapping sources produce one canonical job.
- [ ] Re-running a crawl does not increase the job count.
- [ ] `crawl_runs` shows fetched/created/updated/error counts.

**Files:** `src/modules/crawler/processors/*`, `src/modules/crawler/dedupe.ts`, `src/modules/jobs/jobs.service.ts`

---

### JC-031 · Add source schedulers, seeding, and admin controls
**Priority:** P0 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-030
`area:crawler` `type:feature`

**Tasks**
- [ ] On worker boot, upsert one BullMQ job scheduler per enabled source from `source.cron`.
- [ ] Add a `Run now` action that enqueues an immediate crawl with a dedupe job ID.
- [ ] Add an enable/disable toggle and kill switch per source.
- [ ] Add `/admin/sources` with last-run stats and error preview.
- [ ] Add `/admin/crawl-runs` with filters and pagination.
- [ ] Seed `sources.yaml` with sources disabled until legal review.
- [ ] Ensure changing a schedule updates/removes the old scheduler.

**Done when**
- [ ] Enabling a source and waiting for its cron produces jobs without a restart.
- [ ] Disabling a source prevents future runs.
- [ ] Admins can see the last error for each source.

**Files:** `src/modules/crawler/scheduler.service.ts`, `src/modules/admin/*`, `views/admin/sources.njk`, `data/sources.yaml`

---

### JC-032 · Implement freshness and expiry handling
**Priority:** P1 · **Size:** M · **Status:** 🟡 · **Depends on:** JC-030
`area:crawler` `type:feature`

**Tasks**
- [ ] Add a nightly `deactivate-stale-jobs` job.
- [ ] Deactivate on `expiresAt`, on a 404/410 `applyUrl` HEAD check, or after 45 days unseen.
- [ ] Weekly HEAD-check of `applyUrl` in batches with polite rate limits.
- [ ] Re-activate a job when it is seen again by a crawl.
- [ ] Record `lastSeenAt` and `lastCheckedAt`.
- [ ] Add admin metrics for active/expired/stale counts.
- [ ] Add tests for each deactivation rule.

**Done when**
- [ ] Expired and dead-link jobs disappear from `/jobs` and matches.
- [ ] A re-crawled job becomes active again.
- [ ] The job count trend is visible to admins.

**Files:** `src/modules/jobs/freshness.processor.ts`, `src/modules/admin/*`

---

### JC-033 · Build the `/jobs` search page
**Priority:** P0 · **Size:** XL · **Status:** 🟡 · **Depends on:** JC-005, JC-007, JC-030
`area:jobs` `type:feature`

**Tasks**
- [ ] Search box using Postgres full-text (`websearch_to_tsquery`) with title trigram fallback.
- [ ] Filter sidebar: category, location, remote, employment type, salary, posted within.
- [ ] GET form with `hx-get`, `hx-target="#results"`, `hx-push-url="true"`.
- [ ] Results partial with job cards: title, company, location, salary, posted-ago, remote badge, score when available.
- [ ] Cursor-based "Load more" with `hx-swap="beforeend"`.
- [ ] Preserve filters in the URL and on back/forward.
- [ ] Empty state with suggestions.
- [ ] Add SEO-friendly server-rendered first page.
- [ ] Add query-count and response-time guardrails.
- [ ] Add e2e tests for filters, pagination, and HTMX partial responses.

**Done when**
- [ ] Search returns relevant results in < 300 ms for 5,000 jobs.
- [ ] Filters combine correctly and survive a page refresh.
- [ ] Non-JS users can submit the form and see results.

**Files:** `src/modules/jobs/jobs.controller.ts`, `jobs.service.ts`, `views/jobs/index.njk`, `views/jobs/partials/*`

---

### JC-034 · Build the `/jobs/:id` detail page
**Priority:** P0 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-033
`area:jobs` `type:feature`

**Tasks**
- [ ] Render sanitized description with `| sanitizeHtml | safe`.
- [ ] Facts sidebar: salary, location, remote, employment type, seniority, posted date, source attribution.
- [ ] Add Apply button macro placeholder wired for JC-060.
- [ ] Add "Scan my CV" placeholder wired for JC-054.
- [ ] Add canonical URL, meta description, Open Graph tags.
- [ ] Add `JobPosting` JSON-LD validated against Google's requirements.
- [ ] Add breadcrumbs and related jobs.
- [ ] Return 404 for inactive jobs (or a "no longer available" page with similar jobs).
- [ ] Add e2e tests for active/inactive jobs and JSON-LD presence.

**Done when**
- [ ] Job pages are indexable and pass the Rich Results test.
- [ ] Raw HTML in descriptions cannot execute scripts.
- [ ] An expired job shows a clear unavailable state.

**Files:** `src/modules/jobs/jobs.controller.ts`, `views/jobs/show.njk`, `src/modules/jobs/jsonld.ts`

---

### JC-035 · Add crawler and jobs test coverage
**Priority:** P1 · **Size:** L · **Status:** 🟡 · **Depends on:** JC-030, JC-033
`area:testing` `type:chore`

**Tasks**
- [ ] Adapter tests against recorded fixtures with MSW.
- [ ] Dedupe unit tests: exact fingerprint, fuzzy match, same company within/after 30 days, different company.
- [ ] Pipeline integration test: crawl → upsert → dedupe → enrich enqueue.
- [ ] `/jobs` e2e including HTMX partial and full-page responses.
- [ ] Robots.txt blocking test.
- [ ] Performance test with 5,000 seeded jobs.
- [ ] Add a fixture refresh script.

**Done when**
- [ ] All adapters have at least one success and one malformed-fixture test.
- [ ] Dedupe edge cases are covered.
- [ ] CI runs the jobs e2e suite.

**Files:** `test/crawler/*`, `test/jobs.e2e-spec.ts`

---

## Epic 3 — Enrichment, categorization, and embeddings (M3)

### JC-036 · Add the category taxonomy and category pages
**Priority:** P0 · **Size:** M · **Status:** ❌ · **Depends on:** JC-008
`area:jobs` `type:feature`

**Tasks**
- [ ] Author `categories.json` with ~15 families and ~80 subcategories.
- [ ] Seed two-level categories with stable slugs.
- [ ] Build `/jobs/categories`: grid of families with job counts, linking to filtered `/jobs`.
- [ ] Cache counts in Redis for 10 minutes and invalidate on job changes.
- [ ] Add category filters to `/jobs` and job cards.
- [ ] Add a category admin view for renaming/reparenting (minimal).

**Done when**
- [ ] Every active job has a category after enrichment.
- [ ] Category counts match the filtered job lists.
- [ ] A category page is reachable from the homepage and `/jobs`.

**Files:** `data/categories.json`, `scripts/seed.ts`, `src/modules/jobs/categories.service.ts`, `views/jobs/categories.njk`

---

### JC-037 · Add the `JobEnrichment` schema and prompt
**Priority:** P0 · **Size:** M · **Status:** ❌ · **Depends on:** JC-017, JC-036
`area:ai` `type:feature`

**Tasks**
- [ ] Add `JobEnrichment` Zod schema: runtime `categorySlug` enum from DB, seniority, remote type/regions, employment type, required/preferred skills (max 15/10), min years, salary, apply email, education level, summary (≤ 2 sentences).
- [ ] Add `job_enrich.md` with P2 text and `<job>` data delimiters.
- [ ] Build the category slug list per call (cached).
- [ ] Add a fixture-based test for valid and invalid categories.
- [ ] Add a cheap-model default and per-prompt model config.
- [ ] Enforce "required vs preferred" wording rules in validation (or a post-check).

**Done when**
- [ ] An out-of-list category fails validation and triggers repair.
- [ ] Skills are capped and deduplicated.
- [ ] Salary and apply email are extracted only when stated.

**Files:** `src/common/schemas/job-enrichment.schema.ts`, `src/modules/ai/prompts/job_enrich.md`

---

### JC-038 · Implement the `enrich-job` processor with fallbacks
**Priority:** P0 · **Size:** L · **Status:** ❌ · **Depends on:** JC-037
`area:crawler` `type:feature`

**Tasks**
- [ ] Skip unchanged jobs using a content hash of title + description.
- [ ] Call `completeJson('job_enrich')` on the cheap model.
- [ ] Map required/preferred skills to canonical skills.
- [ ] Derive `applyMethod`: `email` when `applyEmail` exists and no `applyUrl`; `external_ats` when `applyUrl` is an external ATS; otherwise `onsite`.
- [ ] Set category, seniority, remote type, employment type, salary, and summary.
- [ ] On LLM failure, run deterministic keyword rules for category/skills/remote/seniority.
- [ ] Record enrichment source (`llm` vs `fallback`) and prompt version.
- [ ] Enqueue `embed-job` after success.
- [ ] Add tests for routing rules and fallback behavior.

**Done when**
- [ ] A job with an apply email becomes `email` channel.
- [ ] An LLM outage still produces usable enriched jobs via fallback.
- [ ] Re-running enrichment on unchanged content makes no LLM call.

**Files:** `src/modules/crawler/processors/enrich-job.processor.ts`, `src/modules/jobs/enrichment-fallback.ts`

---

### JC-039 · Add the batch embedding scheduler
**Priority:** P0 · **Size:** L · **Status:** ❌ · **Depends on:** JC-018, JC-038
`area:jobs` `type:feature`

**Tasks**
- [ ] Add `embed-jobs` scheduler running every minute.
- [ ] Select up to 64 jobs with `embedding IS NULL` (and optionally stale model version).
- [ ] Build text = title + category + required skills + first 1,500 chars of description.
- [ ] Batch embed, validate dimensions, and update rows in one transaction.
- [ ] Emit `match-new-jobs` for the embedded IDs.
- [ ] Record failures and retry without blocking the batch.
- [ ] Add a backfill script for all active jobs.
- [ ] Add tests for batch size, text construction, and partial failure.

**Done when**
- [ ] 5,000 jobs embed within a reasonable window without rate-limit errors.
- [ ] A failed batch retries only the failed jobs.
- [ ] Re-running does not re-embed already-embedded jobs.

**Files:** `src/modules/jobs/embed-jobs.processor.ts`, `scripts/backfill-embeddings.ts`

---

### JC-040 · Add re-enrichment admin actions and cost controls
**Priority:** P1 · **Size:** M · **Status:** ❌ · **Depends on:** JC-038
`area:admin` `type:feature`

**Tasks**
- [ ] Add a "Re-enrich" button on job detail (admin only).
- [ ] Add a date-range re-enrichment form with a job cap.
- [ ] Show AI cost per day and per prompt on an admin page.
- [ ] Add a daily cost alert threshold from config.
- [ ] Add a "force re-embed" action for a job/profile.
- [ ] Log who triggered a manual re-run.

**Done when**
- [ ] Admins can re-enrich one job or a capped range.
- [ ] Cost dashboards show accurate daily totals.
- [ ] Re-enrichment is idempotent and rate-limited.

**Files:** `src/modules/admin/*`, `views/admin/ai-usage.njk`

---

### JC-041 · Add enrichment and embedding tests
**Priority:** P1 · **Size:** M · **Status:** ❌ · **Depends on:** JC-038, JC-039
`area:testing` `type:chore`

**Tasks**
- [ ] Schema validation tests (category enum, caps, salary).
- [ ] Fallback rule tests (category keywords, remote keywords, apply email).
- [ ] Batch embedder tests (64 limit, partial failure, dimension check).
- [ ] Cache/content-hash tests.
- [ ] Integration test: new job → enrich → embed → match enqueue.

**Done when**
- [ ] LLM failures are simulated with MSW and fallback is asserted.
- [ ] Embedding batches never exceed 64.
- [ ] The pipeline test proves the handoff to matching.

**Files:** `test/enrichment/*`, `test/embedding/*`

---

## Epic 4 — Matching (M4)

### JC-042 · Implement the scoring functions
**Priority:** P0 · **Size:** L · **Status:** ❌ · **Depends on:** JC-004, JC-005
`area:matching` `type:feature`

**Tasks**
- [ ] `semanticScore(cosine)` → 0..1 with clamping.
- [ ] `skillOverlap(profileSkills, required, preferred)` with aliases and required weight ×2.
- [ ] `titleSimilarity(desiredTitles, jobTitle)` using trigram similarity.
- [ ] `locationFit(profile, job)` considering remote preference, city/country, and relocation.
- [ ] `seniorityFit(profile.seniority, job.seniority)`.
- [ ] `salaryFit(profile range, job range)` with a static FX table and currency conversion.
- [ ] `totalScore` weights: 45% semantic, 25% skills, 10% title, 10% location, 5% seniority, 5% salary → 0..100 with breakdown.
- [ ] Handle null/unknown inputs with neutral scores, never NaN.
- [ ] Add exhaustive unit tests with edge cases.

**Done when**
- [ ] Weights sum to 1.0 and scores stay within 0..100.
- [ ] A perfect match scores 100; an empty/unknown profile does not crash.
- [ ] Every factor returns a documented 0..1 value.

**Files:** `src/modules/matching/scoring.ts`, `test/matching/scoring.spec.ts`

---

### JC-043 · Implement `MatchingService.computeForProfile`
**Priority:** P0 · **Size:** XL · **Status:** ❌ · **Depends on:** JC-042, JC-039
`area:matching` `type:feature`

**Tasks**
- [ ] SQL hard filters: active, posted within 30 days, location/remote compatible, not hidden, not already applied.
- [ ] Select top 300 by `cosineDistance(jobs.embedding, profile.embedding)` in Drizzle.
- [ ] Rerank in TypeScript with `totalScore`.
- [ ] Upsert the top 100 into `job_matches`, preserving existing `status`.
- [ ] Delete rows below score 40 and rows outside the top 100.
- [ ] Store the breakdown and `computedAt`; keep the explanation if the job/score is unchanged.
- [ ] Use a single transaction and set-based upsert for performance.
- [ ] Add an index/query check with `EXPLAIN ANALYZE`.
- [ ] Add integration tests with seeded jobs and profiles.

**Done when**
- [ ] Computing matches for a profile with 5,000 jobs takes < 2 s.
- [ ] User-saved/hidden/applied statuses survive recomputation.
- [ ] Jobs below 40 are removed; the top 100 are present.

**Files:** `src/modules/matching/matching.service.ts`

---

### JC-044 · Add matching triggers and schedulers
**Priority:** P1 · **Size:** M · **Status:** ❌ · **Depends on:** JC-043
`area:matching` `type:feature`

**Tasks**
- [ ] On profile/skills/preferences save, enqueue `compute-matches` with job ID `profile:<id>` and a 60 s delay.
- [ ] After `embed-jobs`, enqueue `match-new-jobs` for those IDs, chunked across active profiles.
- [ ] Add a nightly full refresh for active profiles.
- [ ] Skip profiles without an embedding or with incomplete onboarding.
- [ ] Add concurrency limits and per-profile locking.
- [ ] Add metrics for queue depth and compute duration.
- [ ] Add tests for debounce and chunking.

**Done when**
- [ ] Rapid profile edits produce one compute job.
- [ ] A newly embedded job is matched to active profiles within minutes.
- [ ] The nightly refresh is idempotent.

**Files:** `src/modules/matching/matching.processor.ts`, `matching.scheduler.ts`

---

### JC-045 · Implement lazy match explanations
**Priority:** P1 · **Size:** M · **Status:** ❌ · **Depends on:** JC-043, JC-017
`area:ai` `type:feature`

**Tasks**
- [ ] Add `match_explain.md` (P3) with profile/job/breakdown inputs.
- [ ] Generate only when a seeker opens a match; cache in `job_matches.explanation`.
- [ ] Include a content hash so a changed score/job invalidates the cache.
- [ ] Validate output: max 3 fits, max 2 gaps, verdict enum.
- [ ] Handle AI failure with a deterministic fallback explanation from the breakdown.
- [ ] Never claim experience the profile does not show (prompt rule + post-check).
- [ ] Add tests with a mocked AI and a fallback case.

**Done when**
- [ ] Opening the same match twice calls the LLM once.
- [ ] A failed explanation still renders useful breakdown-derived text.
- [ ] Explanations do not repeat the numeric score.

**Files:** `src/modules/ai/prompts/match_explain.md`, `src/modules/matching/explain.service.ts`

---

### JC-046 · Build the `/matches` page
**Priority:** P0 · **Size:** XL · **Status:** ❌ · **Depends on:** JC-043, JC-010
`area:matching` `type:feature`

**Tasks**
- [ ] Card grid with score ring, company, location, salary, posted-ago, top 3 matched skills, top missing skill.
- [ ] Filter/sort bar (category, remote, salary, posted date, score) as `hx-get` + `hx-push-url`.
- [ ] Save/Hide buttons as `hx-post` that swap the card.
- [ ] Pagination or "Load more" with preserved filters.
- [ ] Empty state explaining how to improve matches.
- [ ] Show "already applied" state.
- [ ] Ensure mobile-first responsive layout.
- [ ] Add e2e tests for filters, save/hide, and empty state.

**Done when**
- [ ] A seeker sees a ranked list within 3 minutes of sign-up.
- [ ] Filters update the URL and results without a full reload.
- [ ] Saving a match persists across a refresh.

**Files:** `src/modules/matching/matches.controller.ts`, `views/matches/index.njk`, `views/matches/partials/*`, `views/components/job_card.njk`

---

### JC-047 · Build the match detail slideover
**Priority:** P1 · **Size:** L · **Status:** ❌ · **Depends on:** JC-046
`area:matching` `type:feature`

**Tasks**
- [ ] `hx-get /matches/:id/panel` into an Alpine-controlled slideover.
- [ ] Show breakdown bars per factor with raw values.
- [ ] Load the explanation with `hx-trigger="revealed"` and a skeleton.
- [ ] Add Scan CV and Apply buttons wired to their modules.
- [ ] Add job summary, skills, and link to the full job page.
- [ ] Support closing via Escape, backdrop click, and focus return.
- [ ] Add tests for the panel partial and lazy explanation.

**Done when**
- [ ] The slideover opens without leaving `/matches`.
- [ ] Explanation loads only when visible.
- [ ] Keyboard and screen-reader behavior is correct.

**Files:** `views/matches/partials/panel.njk`, `views/matches/partials/explanation.njk`

---

### JC-048 · Implement save/hide/applied states and undo
**Priority:** P1 · **Size:** M · **Status:** ❌ · **Depends on:** JC-046
`area:matching` `type:feature`

**Tasks**
- [ ] Add `PATCH /matches/:id/status` with allowed transitions.
- [ ] Hide fades the card out and shows an Undo toast.
- [ ] Undo restores the previous status within the toast lifetime.
- [ ] Filter tabs: All, Saved, Hidden (hidden only visible here).
- [ ] Ensure hidden jobs never appear in new match computations.
- [ ] Add authorization tests (cannot change another profile's match).
- [ ] Add tests for undo and status persistence.

**Done when**
- [ ] Hide + Undo restores the card in place.
- [ ] Hidden jobs are excluded from `/matches` and nightly recomputation.
- [ ] Saved jobs survive recomputation.

**Files:** `src/modules/matching/matches.controller.ts`, `views/matches/partials/card.njk`, `views/components/toast.njk`

---

### JC-049 · Add the home dashboard
**Priority:** P2 · **Size:** S · **Status:** ❌ · **Depends on:** JC-046
`area:web` `type:feature`

**Tasks**
- [ ] Show "N new matches since your last visit" for signed-in seekers.
- [ ] Track `lastMatchesViewedAt` on the profile.
- [ ] Add quick links to Matches, Applications, and Profile.
- [ ] Show onboarding progress for incomplete profiles.
- [ ] Keep the marketing landing page for anonymous visitors.

**Done when**
- [ ] The count resets after visiting `/matches`.
- [ ] Anonymous visitors still see the landing page.
- [ ] Incomplete profiles see a resume-onboarding CTA.

**Files:** `src/modules/web/web.controller.ts`, `views/web/home.njk`

---

### JC-050 · Add matching tests and query performance checks
**Priority:** P1 · **Size:** M · **Status:** ❌ · **Depends on:** JC-043
`area:testing` `type:chore`

**Tasks**
- [ ] Unit tests for every scoring function, including nulls and currency conversion.
- [ ] Integration test for hard filters and top-N selection.
- [ ] `/matches` e2e with HTMX partial responses.
- [ ] Query-count assertion to prevent N+1.
- [ ] `EXPLAIN ANALYZE` snapshots for the top-300 query.
- [ ] Seed fixture with 5,000 jobs and 100 profiles for load sanity.

**Done when**
- [ ] Score math is covered by deterministic tests.
- [ ] `/matches` has no N+1 queries.
- [ ] The top-300 query uses the HNSW index.

**Files:** `test/matching/*`, `test/matches.e2e-spec.ts`

---

## Epic 5 — ATS scanner (M5)

### JC-051 · Implement deterministic ATS checks
**Priority:** P0 · **Size:** L · **Status:** ❌ · **Depends on:** JC-019
`area:ats` `type:feature`

**Tasks**
- [ ] Checks: text extractable, scanned PDF, multi-column/tables, images, page count (1–2), standard headings, contact info (email/phone), date consistency, key info outside headers/footers, file-name sanity.
- [ ] Return `{ id, passed, severity, message, fix }` for each check.
- [ ] Use extraction flags (`likelyMultiColumn`, `hasTables`, `hasImages`, `isScanned`) and raw text.
- [ ] Handle resumes with no detectable headings without false-positive hard failures.
- [ ] Add fixture-based tests for pass, warn, and fail cases.

**Done when**
- [ ] A clean one-page resume passes all checks.
- [ ] A scanned/image-only resume fails parseability with a clear fix.
- [ ] Results are stable across repeated runs.

**Files:** `src/modules/ats/checks.ts`, `test/ats/checks.spec.ts`

---

### JC-052 · Implement keyword analysis with wink-nlp
**Priority:** P0 · **Size:** L · **Status:** ❌ · **Depends on:** JC-051, JC-024
`area:ats` `type:feature`

**Tasks**
- [ ] Build the job keyword set: required + preferred skills + top noun phrases.
- [ ] Lemmatize and match against resume text with skill aliases.
- [ ] Report hits with the section where they appear.
- [ ] Rank gaps by importance (required before preferred; frequency).
- [ ] Handle multi-word skills and acronyms/expansions.
- [ ] Add a fallback when wink-nlp finds no phrases.
- [ ] Add tests with fixture resumes and jobs.

**Done when**
- [ ] "JS" matches "JavaScript" via aliases.
- [ ] Hits identify the correct section (Experience, Skills, etc.).
- [ ] Gaps are ordered required-first.

**Files:** `src/modules/ats/keywords.ts`, `test/ats/keywords.spec.ts`

---

### JC-053 · Implement `AtsService.scan()` with LLM review
**Priority:** P0 · **Size:** XL · **Status:** ❌ · **Depends on:** JC-051, JC-052
`area:ats` `type:feature`

**Tasks**
- [ ] Add `ats_review.md` (P4) with job/CV/keyword inputs and strict JSON output.
- [ ] Orchestrate deterministic checks + keyword analysis + LLM review in a queue job.
- [ ] Compute score: 40% keywords + 25% relevance + 20% formatting + 15% sections.
- [ ] Persist `ats_scans` with hits, gaps, issues, suggestions, and bullet rewrites.
- [ ] When `jobId` is null, use the 20 most common skills from the seeker's top matches.
- [ ] Provide deterministic fallbacks if the LLM fails (score still returned).
- [ ] Store the raw LLM output for reprocessing.
- [ ] Add tests for score math and failure fallback.

**Done when**
- [ ] Scanning a CV against a job returns a 0–100 score with a breakdown.
- [ ] An LLM failure still produces formatting/keyword results.
- [ ] Scans complete in under 10 seconds for a typical CV.

**Files:** `src/modules/ats/ats.service.ts`, `src/modules/ai/prompts/ats_review.md`

---

### JC-054 · Build the scan flow and `/ats/:scanId` page
**Priority:** P0 · **Size:** XL · **Status:** ❌ · **Depends on:** JC-053
`area:ats` `type:feature`

**Tasks**
- [ ] "Scan my CV" buttons on job detail, match slideover, and profile.
- [ ] `hx-post` returns a progress partial that polls until ready; then `HX-Redirect` to `/ats/:scanId`.
- [ ] Result page: large score gauge, checklist with pass/fail and fixes, keyword hit/gap badges, bullet rewrites with copy buttons, "Create tailored copy" with progress, download link, list of changes.
- [ ] Show which resume and job were scanned.
- [ ] Handle failure with a retry.
- [ ] Add print-friendly styling.
- [ ] Add e2e tests for the full scan flow.

**Done when**
- [ ] A user can start a scan from any entry point and reach the result.
- [ ] The page renders without waiting for slow work.
- [ ] Copy buttons work without JS errors.

**Files:** `src/modules/ats/ats.controller.ts`, `views/ats/show.njk`, `views/ats/partials/*`, `views/components/score_ring.njk`

---

### JC-055 · Implement CV tailoring and PDF generation
**Priority:** P1 · **Size:** XL · **Status:** ❌ · **Depends on:** JC-053
`area:ats` `type:feature`

**Tasks**
- [ ] Add `cv_tailor.md` (P6) with strict "no invented facts" rules and a changes list.
- [ ] Add `views/cv/ats_template.njk`: single column, standard headings, print CSS, no tables/images.
- [ ] Render the tailored CV to PDF with Playwright `page.pdf()` in the worker.
- [ ] Use the bundled Chromium in the worker container.
- [ ] Save the generated PDF to S3 and create a `resumes` row with `source=generated`.
- [ ] Provide a diff/changes view and explicit user approval before use.
- [ ] Handle generation failures and timeouts.
- [ ] Add tests with a mocked renderer and one real PDF snapshot.

**Done when**
- [ ] "Tailor my CV" produces a downloadable, ATS-safe PDF.
- [ ] The output preserves all original facts and adds no invented metrics.
- [ ] The generated resume appears in the profile resume list.

**Files:** `src/modules/ai/prompts/cv_tailor.md`, `views/cv/ats_template.njk`, `src/modules/ats/cv-render.service.ts`

---

### JC-056 · Enforce scan limits and no-job behavior
**Priority:** P1 · **Size:** S · **Status:** ❌ · **Depends on:** JC-053
`area:ats` `type:feature`

**Tasks**
- [ ] Add a daily limit of 20 scans per user with Redis counters.
- [ ] Return a friendly 429/limit message with reset time.
- [ ] Support scanning without a selected job (top-match skills).
- [ ] Prevent scanning another user's resume (IDOR).
- [ ] Add tests for the limit and authorization.

**Done when**
- [ ] The 21st scan in a day is blocked with a clear message.
- [ ] Users cannot scan resumes they do not own.
- [ ] No-job scans produce meaningful results.

**Files:** `src/modules/ats/*`, `src/common/config/env.schema.ts`

---

### JC-057 · Add ATS test coverage
**Priority:** P1 · **Size:** M · **Status:** ❌ · **Depends on:** JC-051, JC-052, JC-053
`area:testing` `type:chore`

**Tasks**
- [ ] Fixture resumes: clean, scanned, two-column, tables, missing headings, missing contact.
- [ ] Fixture jobs: skill-heavy, generic, no requirements.
- [ ] Unit tests for checks and keyword matching.
- [ ] Score-calculation tests.
- [ ] PDF render integration test (skipped if Chromium unavailable).
- [ ] E2E scan flow.

**Done when**
- [ ] Every check has at least one pass/fail fixture.
- [ ] Score math is tested independently of the LLM.
- [ ] The E2E test covers start → result → tailor → download.

**Files:** `test/ats/*`, `test/fixtures/resumes/*`

---

## Epic 6 — One-click apply and tracker (M6)

### JC-058 · Implement `ApplyService` channel routing
**Priority:** P0 · **Size:** XL · **Status:** ❌ · **Depends on:** JC-006, JC-053
`area:applications` `type:feature`

**Tasks**
- [ ] `apply(profileId, jobId, { resumeId? })` routes on `jobs.applyMethod`.
- [ ] `onsite`: create application, attach the chosen resume, email the employer, mark submitted.
- [ ] `email`: generate a cover letter, send from the platform address with `Reply-To` = seeker and the CV attached, store `messageId`.
- [ ] `external_ats`: build an apply kit, save status `draft`, return `applyUrl`, and let the user mark "I submitted".
- [ ] Enforce `unique(profileId, jobId)` with a clear "already applied" response.
- [ ] Enforce the daily cap (`APPLY_DAILY_LIMIT=25`).
- [ ] Require explicit consent per channel stored on the profile.
- [ ] Require match score ≥ 50 to enable Apply.
- [ ] Use an idempotency key per `(profile, job)`.
- [ ] Store events (`created`, `submitted`, `viewed`, `failed`) with timestamps.
- [ ] Add tests for each channel and guardrail.

**Done when**
- [ ] Onsite and email applications submit end-to-end in a test environment.
- [ ] External ATS returns a complete kit and draft application.
- [ ] Duplicate applies, over-cap applies, and low-score applies are rejected safely.

**Files:** `src/modules/applications/apply.service.ts`, `applications.controller.ts`

---

### JC-059 · Add email sending, cover letters, and bounce handling
**Priority:** P0 · **Size:** L · **Status:** ❌ · **Depends on:** JC-058
`area:applications` `type:feature`

**Tasks**
- [ ] Add `cover_letter.md` (P5) with tone, length, and no-cliché rules.
- [ ] Generate and store the cover letter with the application.
- [ ] Send via Nodemailer/Postmark with the primary or selected resume PDF attached.
- [ ] Set `Reply-To` to the seeker's verified email and a platform `From` address.
- [ ] Add `POST /webhooks/email` with signature verification for bounces/complaints → `failed`.
- [ ] Add SPF/DKIM/DMARC documentation and a dedicated sending domain.
- [ ] Add Mailpit integration tests and a bounce test.
- [ ] Rate-limit outbound email per seeker and per domain.

**Done when**
- [ ] An email-apply job sends a message with the correct recipient, reply-to, and attachment in Mailpit.
- [ ] A bounce webhook moves the application to `failed` with a reason.
- [ ] A generated cover letter passes the prompt schema and contains no placeholders.

**Files:** `src/modules/ai/prompts/cover_letter.md`, `src/common/mail/*`, `src/modules/applications/email-apply.service.ts`, `src/modules/applications/webhooks.controller.ts`

---

### JC-060 · Build the apply UX with consent and idempotency
**Priority:** P0 · **Size:** L · **Status:** ❌ · **Depends on:** JC-058, JC-010
`area:applications` `type:feature`

**Tasks**
- [ ] Add an `apply_button` macro for job cards, job detail, and match slideover.
- [ ] First apply opens a consent modal listing exactly what will be sent and to whom.
- [ ] After consent, `hx-post /applications` returns the updated button ("Applied ✓") and a toast.
- [ ] Disable the button while in flight; support retry on failure.
- [ ] For `external_ats`, return a kit slideover with download/copy, "Open application page" (`target=_blank`), and "I've submitted".
- [ ] Show the channel and destination in the UI.
- [ ] Handle 409 (already applied), 429 (cap), and 403 (score too low) with specific messages.
- [ ] Add tests for consent, idempotency, and each error state.

**Done when**
- [ ] No application is sent without an explicit click and consent.
- [ ] Double-clicking does not create two applications.
- [ ] The external ATS flow never claims automatic submission.

**Files:** `views/components/apply_button.njk`, `views/applications/partials/*`, `src/modules/applications/applications.controller.ts`

---

### JC-061 · Implement the external-ATS apply kit
**Priority:** P1 · **Size:** L · **Status:** ❌ · **Depends on:** JC-055, JC-058
`area:applications` `type:feature`

**Tasks**
- [ ] Build a kit containing the tailored CV PDF, cover letter, and screening answers.
- [ ] Add `screening_answers.md` (P7) with `needs_input` for missing facts.
- [ ] Store the kit on the application (`answers jsonb`, resume ID, cover letter).
- [ ] Provide download/copy actions and a print view.
- [ ] Add "I've submitted" to move `draft → submitted`.
- [ ] Add reminders for drafts older than 7 days (optional).
- [ ] Add tests for kit assembly and `needs_input` handling.

**Done when**
- [ ] A kit contains all three artifacts and no placeholder text.
- [ ] Missing facts are flagged instead of guessed.
- [ ] Marking submitted records the event and timestamp.

**Files:** `src/modules/applications/apply-kit.service.ts`, `src/modules/ai/prompts/screening_answers.md`, `views/applications/partials/kit.njk`

---

### JC-062 · Build the application tracker
**Priority:** P0 · **Size:** XL · **Status:** ❌ · **Depends on:** JC-058
`area:applications` `type:feature`

**Tasks**
- [ ] `/applications` Kanban: Draft, Submitted, Interview, Offer, Rejected.
- [ ] Drag-and-drop with SortableJS; `hx-patch` on drop to change status.
- [ ] Card detail slideover with job/company, resume, cover letter, timeline, and notes form.
- [ ] Add withdraw action with confirmation.
- [ ] Add empty state and filters (channel, status, date).
- [ ] Ensure status transitions are validated server-side.
- [ ] Add e2e tests for drag/drop and notes.
- [ ] Provide a non-JS fallback for status changes.

**Done when**
- [ ] Dragging a card persists the new status after refresh.
- [ ] Every application is visible and withdrawable.
- [ ] The timeline shows all events in order.

**Files:** `src/modules/applications/applications.controller.ts`, `views/applications/index.njk`, `views/applications/partials/*`

---

### JC-063 · Build the minimal employer side
**Priority:** P1 · **Size:** L · **Status:** ❌ · **Depends on:** JC-058
`area:employer` `type:feature`

**Tasks**
- [ ] Employer role onboarding (or admin-created employer accounts).
- [ ] `/employer/jobs/new` form with `applyMethod=onsite`.
- [ ] Employer job list and edit/close actions.
- [ ] `/employer/jobs/:id/applicants` with primary resume link and ATS score per applicant.
- [ ] Authorization: employers see only their own jobs/applicants.
- [ ] Add tests for IDOR and role access.

**Done when**
- [ ] An employer can post an onsite job and receive applications.
- [ ] Applicants show the correct ATS score.
- [ ] A seeker cannot access employer routes (403).

**Files:** `src/modules/employer/*` (new) or `src/modules/applications/employer.controller.ts`, `views/employer/*`

---

### JC-064 · Add application-flow tests
**Priority:** P1 · **Size:** L · **Status:** ❌ · **Depends on:** JC-058, JC-059, JC-060, JC-062
`area:testing` `type:chore`

**Tasks**
- [ ] Channel-routing unit tests.
- [ ] Daily cap and idempotency tests.
- [ ] Email via Mailpit (recipient, reply-to, attachment, subject).
- [ ] Bounce webhook test.
- [ ] Kanban status endpoint test.
- [ ] Consent requirement test.
- [ ] Employer authorization tests.

**Done when**
- [ ] Every guardrail has a failing-path test.
- [ ] Email tests run in CI with Mailpit.
- [ ] The E2E happy path covers apply → tracker.

**Files:** `test/applications/*`, `test/applications.e2e-spec.ts`

---

## Epic 7 — Hardening and launch (M7)

### JC-065 · Security hardening
**Priority:** P0 · **Size:** L · **Status:** ❌ · **Depends on:** JC-011, JC-058
`area:security` `type:feature`

**Tasks**
- [ ] Strict CSP: self-host HTMX/Alpine, no inline scripts except nonce'd.
- [ ] Audit every mutating route for CSRF (forms + HTMX headers).
- [ ] Throttle auth, upload, scan, and apply endpoints.
- [ ] ClamAV scan of uploads in the worker before parsing.
- [ ] Private S3 with short-lived presigned GETs; no public buckets.
- [ ] Encrypt phone numbers at rest (and any sensitive PII).
- [ ] `trust proxy` and secure cookie settings in production.
- [ ] Add `npm audit`/Dependabot to CI.
- [ ] Add security headers test and an OWASP checklist.
- [ ] Escape/sanitize all user- and job-provided HTML.

**Done when**
- [ ] CSP has no `unsafe-inline` for scripts.
- [ ] An infected test file is quarantined and never parsed.
- [ ] Uploaded files are unreachable without a short-lived signed URL.

**Files:** `src/bootstrap.ts`, `src/modules/profiles/resume-upload.service.ts`, `src/common/security/*`, `.github/workflows/security.yml`

---

### JC-066 · Implement data rights and legal pages
**Priority:** P1 · **Size:** L · **Status:** ❌ · **Depends on:** JC-014
`area:compliance` `type:feature`

**Tasks**
- [ ] Account export: JSON of profile/applications plus a ZIP of resumes.
- [ ] Hard delete: remove DB rows, S3 objects, sessions, and queue jobs.
- [ ] Add privacy policy, terms, and cookie policy pages.
- [ ] Explicit consent checkbox at CV upload with purpose limitation text.
- [ ] Essential-only cookies by default; no analytics without consent.
- [ ] Document LLM data-processing terms and "no training on user data".
- [ ] Add retention policy for raw CV text/LLM outputs.
- [ ] Register with the ODPC if required; document the decision.
- [ ] Add tests for export and delete.

**Done when**
- [ ] A user can export and delete their account from settings.
- [ ] Deletion removes all PII and files.
- [ ] Consent is recorded with timestamp and version.

**Files:** `src/modules/users/data-rights.service.ts`, `views/legal/*`, `views/profiles/settings.njk`

---

### JC-067 · Performance and caching
**Priority:** P1 · **Size:** L · **Status:** ❌ · **Depends on:** JC-033, JC-046
`area:performance` `type:feature`

**Tasks**
- [ ] `EXPLAIN ANALYZE` `/jobs` search and `/matches`; add missing indexes.
- [ ] Redis cache for categories, counts, and hot job pages (with sensible TTLs).
- [ ] HTTP caching for public job pages (`ETag`, `Cache-Control`).
- [ ] Compress static assets and set long cache headers with hashed filenames.
- [ ] Add query-count guards in tests for `/jobs` and `/matches`.
- [ ] Lighthouse ≥ 90 on `/jobs` (performance, accessibility, best practices, SEO).
- [ ] Add a simple load test for 5,000 jobs / 100 concurrent users.
- [ ] Optimize images and avoid layout shift.

**Done when**
- [ ] `/jobs` and `/matches` p95 < 500 ms under the test load.
- [ ] Lighthouse scores ≥ 90.
- [ ] No N+1 queries remain in the hot paths.

**Files:** `src/modules/jobs/*`, `src/modules/matching/*`, `assets/input.css`, `views/layouts/base.njk`

---

### JC-068 · SEO
**Priority:** P1 · **Size:** M · **Status:** ❌ · **Depends on:** JC-034
`area:seo` `type:feature`

**Tasks**
- [ ] `sitemap.xml` of active jobs with `lastmod`; split if > 50k URLs.
- [ ] Canonical URLs on all public pages.
- [ ] Validate `JobPosting` JSON-LD against Google's requirements.
- [ ] Add `robots.txt` that allows jobs and blocks private areas.
- [ ] Add Open Graph/Twitter meta tags.
- [ ] Add clean slugs (`/jobs/:id/:slug`) with redirects from bare IDs.
- [ ] Add structured breadcrumbs.
- [ ] Submit the sitemap in Search Console (launch task).

**Done when**
- [ ] Rich Results test passes for a job page.
- [ ] `sitemap.xml` lists only active, canonical jobs.
- [ ] Private pages are `noindex`.

**Files:** `src/modules/jobs/sitemap.controller.ts`, `public/robots.txt`, `views/jobs/show.njk`

---

### JC-069 · Observability and admin health
**Priority:** P1 · **Size:** L · **Status:** ❌ · **Depends on:** JC-011, JC-031
`area:observability` `type:feature`

**Tasks**
- [ ] Sentry for web and worker with release and environment tags.
- [ ] pino JSON logs to stdout; redact secrets and PII.
- [ ] Bull Board behind admin auth.
- [ ] `/admin/health`: per-source crawl health, last success, error rate.
- [ ] AI cost per day and per prompt.
- [ ] Parse failure rate and queue depths.
- [ ] Alerts for failed crawls, queue backlog, AI cost threshold, and error spikes.
- [ ] Add correlation IDs across web → queue → worker.

**Done when**
- [ ] A failed worker job is traceable from the request ID to Sentry.
- [ ] Admins can see source health and AI spend without SQL.
- [ ] Alerts fire in a staging test.

**Files:** `src/common/logging/*`, `src/modules/admin/*`, `views/admin/health.njk`

---

### JC-070 · Add notifications
**Priority:** P2 · **Size:** M · **Status:** ❌ · **Depends on:** JC-059, JC-046
`area:notifications` `type:feature`

**Tasks**
- [ ] Opt-in daily digest of matches above 75.
- [ ] Application status emails (submitted, viewed, interview, offer, rejected).
- [ ] Unsubscribe link and preference center.
- [ ] Batch sending through a queue with rate limits.
- [ ] Avoid sending duplicates on job status changes.
- [ ] Add tests with Mailpit and a fake clock.

**Done when**
- [ ] A user can opt in/out and receives at most one digest per day.
- [ ] Unsubscribe works without login.
- [ ] Status emails reflect real transitions only.

**Files:** `src/modules/notifications/*`, `src/common/mail/*`

---

### JC-071 · Production Docker image and deployment
**Priority:** P0 · **Size:** XL · **Status:** ❌ · **Depends on:** JC-002, JC-012
`area:infra` `type:infra`

**Tasks**
- [ ] Multi-stage Dockerfile: install → build (Tailwind + Nest) → runtime with Playwright Chromium.
- [ ] Run as a non-root user; include only production dependencies.
- [ ] One image, two services: `node dist/main.js` and `node dist/worker.js`.
- [ ] Add production Compose (web, worker, Postgres, Redis, MinIO/S3, reverse proxy).
- [ ] Run migrations on release (init job or entrypoint).
- [ ] Add health checks and restart policies.
- [ ] Configure Postgres backups and test a restore.
- [ ] Add staging and production environment docs/secrets.
- [ ] Add zero-downtime deploy notes.

**Done when**
- [ ] `docker compose -f docker-compose.prod.yml up` serves the app and processes jobs.
- [ ] Playwright PDF generation works inside the worker container.
- [ ] A restore from backup is verified.

**Files:** `Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`, `docs/deploy.md`

---

### JC-072 · Add the Playwright end-to-end happy path
**Priority:** P1 · **Size:** L · **Status:** ❌ · **Depends on:** JC-015, JC-046, JC-054, JC-058
`area:testing` `type:chore`

**Tasks**
- [ ] Sign up → verify email (Mailpit API) → upload CV → review profile → preferences → matches.
- [ ] Open a match → scan CV → view score → tailor → download.
- [ ] Apply to an email-channel job → confirm consent → see tracker entry.
- [ ] Run against a seeded database and a mocked/recorded LLM.
- [ ] Add screenshots/videos on failure.
- [ ] Run in CI against the Docker Compose stack.
- [ ] Add a smoke test for the worker pipeline.

**Done when**
- [ ] The full journey passes reliably in CI.
- [ ] Failures produce actionable artifacts.
- [ ] The test runs in under 10 minutes.

**Files:** `e2e/*.spec.ts`, `playwright.config.ts`, `.github/workflows/e2e.yml`

---

### JC-073 · Add the prompt regression suite
**Priority:** P1 · **Size:** M · **Status:** ❌ · **Depends on:** JC-017, JC-020, JC-037, JC-045, JC-053, JC-055, JC-061
`area:ai` `type:chore`

**Tasks**
- [ ] Build a golden set: 20 CVs and 50 jobs with expected structured outputs.
- [ ] Snapshot schema-valid outputs, not exact prose, for subjective prompts.
- [ ] Run the suite in CI whenever a prompt file changes.
- [ ] Track model/prompt version with each golden result.
- [ ] Add a cost/time budget for the suite.
- [ ] Add a manual review checklist for tone/factual accuracy.
- [ ] Block prompt changes that regress schema validity or factuality checks.

**Done when**
- [ ] A prompt change triggers the regression suite.
- [ ] Factuality checks catch invented employers, dates, or numbers.
- [ ] The suite runs within the CI budget.

**Files:** `test/prompts/*`, `test/fixtures/golden/*`, `.github/workflows/prompts.yml`

---

### JC-074 · Launch checklist and legal source review
**Priority:** P0 · **Size:** M · **Status:** ❌ · **Depends on:** JC-065, JC-066, JC-067, JC-068, JC-069, JC-071
`area:launch` `type:chore`

**Tasks**
- [ ] Legal review of every enabled job source (terms, robots.txt, attribution).
- [ ] Confirm no login-protected or LinkedIn scraping.
- [ ] Verify privacy policy, terms, consent, export/delete.
- [ ] Verify backups, monitoring, alerts, and on-call contact.
- [ ] Verify SPF/DKIM/DMARC and warm up the sending domain.
- [ ] Load a minimum of 5,000 active, de-duplicated jobs from ≥ 6 sources.
- [ ] Run the Playwright happy path on production.
- [ ] Check Lighthouse, sitemap, and Rich Results on production.
- [ ] Document rollback and incident procedures.
- [ ] Tag `v0.1.0` and publish release notes.

**Done when**
- [ ] Every MVP success criterion in section 5 is checked on production.
- [ ] No source is enabled without documented legal approval.
- [ ] Rollback has been rehearsed.

---

## 5. MVP acceptance criteria (from the build plan)

Use this as the final gate. Every box must be checked on production.

- [ ] **5,000+** live, de-duplicated jobs refreshed daily from at least **6 sources**.
- [ ] A seeker goes from sign-up to a ranked list of matched jobs in **under 3 minutes** (upload CV → review parsed profile → see matches).
- [ ] ATS score and keyword-gap report for any job in **under 10 seconds**.
- [ ] One-click apply works end-to-end for at least **two channels**: on-platform jobs and email-apply jobs.
- [ ] LinkedIn data is imported only from user-owned exports (PDF/ZIP); no scraping.
- [ ] External ATS jobs produce a tailored CV + cover letter + answers kit and open the employer page; no false claim of submission.
- [ ] Recruiter dashboards, billing, mobile apps, interview prep, salary prediction, and unattended auto-apply remain out of scope.

---

## 6. Cross-cutting definition of done

Every feature issue must also satisfy:

- [ ] **Typed:** no `any`, no unchecked casts; Zod at every boundary.
- [ ] **Validated:** forms and JSON share schemas; errors render with 422 and field messages.
- [ ] **Safe:** CSRF on mutations; output escaped; job HTML sanitized; authorization checked (IDOR tests).
- [ ] **Async:** slow work runs in the worker; controllers enqueue and return polling partials.
- [ ] **Observable:** failures logged with context; AI calls recorded; queue errors visible.
- [ ] **Tested:** unit tests for logic, e2e for controllers, MSW for outbound HTTP, AI mocked.
- [ ] **Accessible:** labels, focus states, keyboard paths, semantic landmarks.
- [ ] **Mobile-first:** usable at 360 px width.
- [ ] **Documented:** README/env/API notes updated; raw inputs stored for reprocessing.
- [ ] **No new dependency** without checking it against `CLAUDE.md`.

---

## 7. Critical path and dependencies

```
JC-001 → JC-002 → JC-003
   └──→ JC-004 → JC-005 → JC-006 → JC-007 → JC-008
          └──→ JC-014
          └──→ JC-017 → JC-018
                 └──→ JC-019/020 → JC-021 → JC-023
                        └──→ JC-022, JC-024
   └──→ JC-009 → JC-010 → JC-015 → JC-016
   └──→ JC-011, JC-012 → JC-013

JC-005/007/008 → JC-025 → JC-026 → JC-027/028/029
        └──→ JC-030 → JC-031/032 → JC-033/034 → JC-036
                └──→ JC-038 (needs JC-037) → JC-039 → JC-043
                        └──→ JC-044 → JC-045 → JC-046/047/048

JC-019 → JC-051 → JC-052 → JC-053 → JC-054 → JC-055
JC-043 → JC-058 → JC-059/060/061/062/063

All of the above → JC-065..JC-074 → launch
```

**Suggested execution order for a single developer**

1. JC-001 → JC-002 → JC-003 (environment)
2. JC-004 → JC-005 → JC-006 → JC-007 → JC-008 (schema foundation)
3. JC-009 → JC-010 → JC-011 → JC-012 → JC-013 (shell + CI)
4. JC-014 → JC-015 → JC-016 (finish auth/profile UX)
5. JC-017 → JC-018 → JC-019 → JC-020 → JC-021 → JC-022 → JC-023 → JC-024 (profile intelligence)
6. JC-025 → JC-026 → JC-027 → JC-028 → JC-029 → JC-030 → JC-031 → JC-032 → JC-033 → JC-034 → JC-035 (jobs)
7. JC-036 → JC-037 → JC-038 → JC-039 → JC-040 → JC-041 (enrichment) — **Gate 1**
8. JC-042 → JC-043 → JC-044 → JC-045 → JC-046 → JC-047 → JC-048 → JC-049 → JC-050 (matching)
9. JC-051 → JC-052 → JC-053 → JC-054 → JC-055 → JC-056 → JC-057 (ATS)
10. JC-058 → JC-059 → JC-060 → JC-061 → JC-062 → JC-063 → JC-064 (apply) — **Gate 2**
11. JC-065 → JC-066 → JC-067 → JC-068 → JC-069 → JC-070 → JC-071 → JC-072 → JC-073 → JC-074 (launch)

---

## 8. Decisions needed before/while building

Record the answer in an ADR or in the issue before implementation.

1. **Embedding provider/model** — which 1024-dimension model, and what is the re-embedding plan?
2. **LLM models** — cheap model for P2 (job enrichment), stronger model for P4–P6 (user-facing writing), and fallback behavior.
3. **Email provider** — Postmark vs SES; sending domain and reply-to policy.
4. **File storage** — S3 in production vs MinIO locally; presigned URL lifetime.
5. **FX rates** — source and refresh cadence for salary conversion (static table is acceptable for MVP).
6. **Job sources** — final list of ≥ 6 legally approved sources and attribution requirements.
7. **Auth/verification** — whether to keep mandatory email verification before login; whether password reset is in MVP.
8. **Onsite apply semantics** — does the employer receive email only, or is there an employer dashboard notification too?
9. **Minimum match score** — confirm 50 as the Apply gate and 40 as the match retention cutoff.
10. **Data retention** — how long to keep raw CV text, parsed JSON, and LLM outputs.

---

## 9. Explicitly out of scope for the MVP

Do not create implementation issues for these until the MVP gate is passed:

- Recruiter dashboards and paid listings (beyond the minimal employer MVP in JC-063)
- Billing, subscriptions, M-Pesa payments
- Mobile apps
- Interview preparation
- Salary prediction / insights
- Unattended auto-apply without an explicit user click
- Browser-extension autofill for Greenhouse/Lever/Workday (post-MVP, order #1)
- Learning-to-rank from feedback
- WhatsApp/SMS alerts
- LinkedIn scraping or any login-protected crawling

---

## 10. Post-MVP backlog (for later, not required for launch)

These are listed for context only; they are not part of the completion criteria above.

1. Browser extension that autofills Greenhouse/Lever/Workday from the apply kit (user still clicks Submit).
2. Employer side: applicant ranking with the same ATS scorer, paid listings.
3. Learning-to-rank from saves, hides, applies, and interviews.
4. WhatsApp/SMS job alerts (Kenyan market) and M-Pesa premium tiers.
5. Interview prep and salary insights from collected job data.
6. Public `/api/v1` JSON endpoints for a future mobile app or extension.

---

*Generated from the Job Copilot MVP build plan and a repository audit of `teamhardware30/teamhardware30` at commit `0bd43de`.*

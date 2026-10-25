# Job Copilot

Job Copilot crawls job postings, builds a structured seeker profile from a CV or
LinkedIn export, matches jobs to seekers, scans CVs like an ATS, and supports
one-click apply.

The app is a single NestJS 11 service with server-rendered Nunjucks views and
HTMX/Alpine on the client:

- `src/main.ts` — web process (pages, HTMX partials, `/api/v1`)
- `src/worker.ts` — worker process (BullMQ processors and schedulers)
- `src/db/` — Drizzle schema and migrations
- `views/` — Nunjucks layouts, components, and pages
- `assets/input.css` → `public/css/app.css` — Tailwind build

---

## Prerequisites

- **Node.js 22+** (22 LTS recommended) and **pnpm 9** (`corepack pnpm` works
  without installing pnpm globally)
- **PostgreSQL 16** with the **pgvector** and **pg_trgm** extensions
- **Redis 6.2+** (Redis 8 recommended)
- **SMTP server** for verification emails. Locally, use
  [Mailpit](https://github.com/axllent/mailpit) and read mail at
  <http://localhost:8025>.
- Optional: S3-compatible storage (resume uploads), `ANTHROPIC_API_KEY`
  (CV parsing), embedding provider key (profile/job embeddings)
- Docker is **not** required to run the app, but `pnpm test:e2e` uses
  Testcontainers and therefore does require a working Docker daemon.

There is no `docker-compose.yml` in the repo yet (tracked as JC-002), so use an
existing Postgres/Redis instance or the portable Windows setup below.

---

## Quick start (Windows, no Docker)

These instructions use portable services installed under
`%LOCALAPPDATA%\job-copilot-dev`, so no administrator rights are needed.

### 1. First-time setup (only once)

Create the directories:

```powershell
$root = "$env:LOCALAPPDATA\job-copilot-dev"
New-Item -ItemType Directory -Force -Path "$root\downloads","$root\pg","$root\pgdata","$root\redis8","$root\mailpit" | Out-Null
```

Download the services (versions used at the time of writing):

```powershell
$root = "$env:LOCALAPPDATA\job-copilot-dev"
curl.exe -L --fail -o "$root\downloads\pg.zip" `
  "https://get.enterprisedb.com/postgresql/postgresql-16.9-1-windows-x64-binaries.zip"

curl.exe -L --fail -o "$root\downloads\pgvector.zip" `
  "https://github.com/andreiramani/pgvector_pgsql_windows/releases/download/0.8.7/vector.v0.8.7-pg16.zip"

curl.exe -L --fail -o "$root\downloads\redis.zip" `
  "https://github.com/redis-windows/redis-windows/releases/download/8.10.2/Redis-8.10.2-Windows-x64-msys2.zip"

curl.exe -L --fail -o "$root\downloads\mailpit.zip" `
  "https://github.com/axllent/mailpit/releases/download/v1.32.0/mailpit-windows-amd64.zip"
```

The pgvector zip is a community-maintained Windows build. On Linux/macOS,
install pgvector through your package manager or build it from source instead.

Extract them:

```powershell
$root = "$env:LOCALAPPDATA\job-copilot-dev"
tar -xf "$root\downloads\pg.zip" -C "$root\pg"
New-Item -ItemType Directory -Force -Path "$root\downloads\pgvector" | Out-Null
tar -xf "$root\downloads\pgvector.zip" -C "$root\downloads\pgvector"
tar -xf "$root\downloads\redis.zip" -C "$root\redis8"
tar -xf "$root\downloads\mailpit.zip" -C "$root\mailpit"
```

Install the pgvector extension into the PostgreSQL tree:

```powershell
$root = "$env:LOCALAPPDATA\job-copilot-dev"
$pg = "$root\pg\pgsql"
Copy-Item "$root\downloads\pgvector\lib\vector.dll" "$pg\lib\"
Copy-Item "$root\downloads\pgvector\share\extension\*" "$pg\share\extension\" -Force
New-Item -ItemType Directory -Force -Path "$pg\include\server\extension\vector" | Out-Null
Copy-Item "$root\downloads\pgvector\include\server\extension\vector\*" "$pg\include\server\extension\vector\" -Force
```

Initialise the database cluster and create the app database:

```powershell
$root = "$env:LOCALAPPDATA\job-copilot-dev"
$pg = "$root\pg\pgsql"
& "$pg\bin\initdb.exe" -D "$root\pgdata" -U postgres -A trust -E UTF8 --locale=C
& "$pg\bin\pg_ctl.exe" -D "$root\pgdata" -l "$root\pg.log" -o "-p 5432" start
& "$pg\bin\createdb.exe" -U postgres -p 5432 job_copilot
& "$pg\bin\pg_ctl.exe" -D "$root\pgdata" stop -m fast
```

### 2. Daily start

Start the three local services:

```powershell
$root = "$env:LOCALAPPDATA\job-copilot-dev"

& "$root\pg\pgsql\bin\pg_ctl.exe" -D "$root\pgdata" -l "$root\pg.log" -o "-p 5432" start

Start-Process "$root\redis8\Redis-8.10.2-Windows-x64-msys2\redis-server.exe" `
  -ArgumentList '--port','6379','--save','""','--appendonly','no' -WindowStyle Hidden

Start-Process "$root\mailpit\mailpit.exe" `
  -ArgumentList '--smtp','127.0.0.1:1025','--listen','127.0.0.1:8025','--database',"$root\mailpit\mailpit.db" -WindowStyle Hidden
```

Create `.env` and replace both secrets with strings of at least 16 characters
(the `change-me` placeholders in `.env.example` are rejected at boot). You can
start from the example:

```powershell
Copy-Item .env.example .env
```

For the portable services, `.env` should contain at least:

```dotenv
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000

DATABASE_URL=postgres://postgres:postgres@localhost:5432/job_copilot
REDIS_URL=redis://localhost:6379

SESSION_SECRET=local-dev-session-secret-change-me-32chars
CSRF_SECRET=local-dev-csrf-secret-change-me-32chars

SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_FROM=no-reply@job-copilot.local
```

Install dependencies, build the CSS, and apply migrations:

```powershell
pnpm install
pnpm css:build
pnpm db:migrate
```

Run the web app and the worker in **two separate terminals**:

```powershell
pnpm start:dev
```

```powershell
pnpm start:worker:dev
```

If `pnpm` is not on your `PATH`, use `corepack pnpm ...` instead.

Open:

- App: <http://localhost:3000>
- Mailpit: <http://localhost:8025>

Register an account and open the verification email in Mailpit to activate it.

### 3. Stop

Stop the two app processes (`Ctrl+C` in each terminal), then:

```powershell
$root = "$env:LOCALAPPDATA\job-copilot-dev"
& "$root\pg\pgsql\bin\pg_ctl.exe" -D "$root\pgdata" stop -m fast
& "$root\redis8\Redis-8.10.2-Windows-x64-msys2\redis-cli.exe" shutdown nosave
Get-Process mailpit -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## Using existing Postgres and Redis

Point `.env` at your services:

```dotenv
DATABASE_URL=postgres://user:password@localhost:5432/job_copilot
REDIS_URL=redis://localhost:6379
```

The database needs the `vector` and `pg_trgm` extensions. Run migrations as a
user allowed to create extensions:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Then run `pnpm db:migrate`.

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `test`, or `production` |
| `PORT` | no | `3000` | Web process port |
| `APP_URL` | no | `http://localhost:3000` | Used in verification links |
| `DATABASE_URL` | **yes** | — | Postgres connection string |
| `REDIS_URL` | **yes** | — | Redis connection string |
| `SESSION_SECRET` | **yes** | — | Minimum 16 characters |
| `CSRF_SECRET` | **yes** | — | Minimum 16 characters |
| `SMTP_HOST` / `SMTP_PORT` | no | — | Required for verification emails |
| `SMTP_USER` / `SMTP_PASS` | no | — | Omit for Mailpit |
| `SMTP_FROM` | no | `no-reply@job-copilot.local` | Sender address |
| `LINKEDIN_CLIENT_ID` / `SECRET` | no | — | LinkedIn OIDC login |
| `GOOGLE_CLIENT_ID` / `SECRET` | no | — | Google OAuth login |
| `ANTHROPIC_API_KEY` | no | — | CV parsing and AI features |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-4-5` | |
| `EMBEDDING_PROVIDER` | no | `voyage` | `voyage` or `none` |
| `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` | no | — / `voyage-2` | |
| `AWS_REGION` | no | `us-east-1` | |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | no | — | Resume uploads |
| `S3_BUCKET` | no | — | Resume uploads |
| `CRAWLER_CONTACT_EMAIL` | no | `crawler@job-copilot.local` | Contact address in the crawler user agent |
| `CRAWLER_REQUESTS_PER_SECOND` | no | `1` | Per-domain rate limit |
| `CRAWLER_RESPECT_ROBOTS` | no | `true` | Set to `false` only for sources you own |
| `CRAWLER_TIMEOUT_MS` | no | `20000` | Per-request timeout |

Resume upload/parsing and AI features stay disabled until the corresponding
storage and AI credentials are configured. Everything else runs without them.

---

## Crawler

Job sources are declared in `sources.yaml` and upserted into the `sources`
table (matched by `name`):

```powershell
pnpm db:seed:sources
```

Each entry has a `kind` that selects the adapter:

| `kind` | Adapter | `config` |
|---|---|---|
| `greenhouse` | Greenhouse boards API | `companies: [{ token, name }]` |
| `lever` | Lever postings API | `companies: [{ token, name }]` |
| `ashby` | Ashby job board API | `companies: [{ token, name }]` |
| `remotive` | Remotive feed API | `limit`, optional `category` |
| `arbeitnow` | Arbeitnow feed API | `maxPages` |
| `jsonld` | schema.org `JobPosting` pages | `sitemapUrl` or `listingUrl`, `urlPattern`, `maxPages` |
| `html` | CSS-selector scraper | `listingUrl`, `itemSelector`, `fields`, `detailDescriptionSelector`, `paginationSelector`, `maxPages` |

The worker (`pnpm start:worker:dev`) registers one BullMQ job scheduler per
enabled source from its `cron`, plus a nightly `deactivate-stale-jobs` job at
03:00. The pipeline is:

1. `crawl-source` — runs the adapter and normalizes records with Zod.
2. `upsert-jobs` — writes batches of 100, resolving `companies`/`categories`
   and matching on `(source_id, external_id)` or `fingerprint`.
3. `dedupe` — SHA-1 fingerprint `title|company|city`, then a `pg_trgm`
   similarity check (> 0.9, same company, last 30 days) that deactivates
   near-duplicates.
4. `enrich-job` — placeholder for embeddings/skill extraction.

`crawl_runs` records each attempt (found/created/updated/skipped and errors).

Requests are polite by default: one request per second per domain, a
`JobCopilotBot/0.1 (+contact email)` user agent, `robots.txt` cached in Redis
for 24 hours, `ETag` / `If-Modified-Since` conditional requests, and
exponential-backoff retries. URLs disallowed by `robots.txt` are skipped and
logged. Remotive is seeded disabled because its `robots.txt` disallows
`/api/*`; enable it only with permission.

Admins can enable/disable sources and trigger a run from `/admin/sources`, and
inspect history at `/admin/crawl-runs`.

---

## Scripts

| Command | Description |
|---|---|
| `pnpm start:dev` | Web app in watch mode |
| `pnpm start:worker:dev` | Run the worker via `ts-node` (no watch) |
| `pnpm build` | Compile to `dist/` (also copies views and AI prompts) |
| `pnpm start` | Run the compiled web app |
| `pnpm start:worker` | Run the compiled worker |
| `pnpm css:build` | Build `public/css/app.css` once |
| `pnpm css:watch` | Rebuild CSS on change |
| `pnpm db:generate` | Generate a Drizzle migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed:sources` | Upsert crawl sources from `sources.yaml` |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:watch` | Unit tests in watch mode |
| `pnpm test:e2e` | E2E tests (requires Docker for Testcontainers) |
| `pnpm exec tsc --noEmit` | Type check (no `typecheck` script yet) |

`public/css/app.css` is generated and git-ignored, so run `pnpm css:build` (or
`pnpm css:watch`) after a fresh clone or the pages will render unstyled.

`pnpm lint` is not usable yet: the ESLint config is still tracked as JC-012.

---

## Tests

Unit tests do not need external services:

```powershell
pnpm test
```

E2E tests start throwaway Postgres (`pgvector/pgvector:pg16`) and Redis
(`redis:7-alpine`) containers, so they need a running Docker daemon:

```powershell
pnpm test:e2e
```

---

## Troubleshooting

- **Port already in use (`EADDRINUSE`)** — stop the process using port 3000, or
  change `PORT` in `.env`.
- **`Invalid environment configuration` at boot** — `SESSION_SECRET` and
  `CSRF_SECRET` must each be at least 16 characters, and `DATABASE_URL` /
  `REDIS_URL` must be valid URLs.
- **Redis connection errors** — check that `redis-server` is running on
  `localhost:6379` (`redis-cli ping` should return `PONG`).
- **Postgres will not start** — read `%LOCALAPPDATA%\job-copilot-dev\pg.log`.
- **`extension "vector" is not available`** — pgvector was not copied into the
  PostgreSQL `lib`/`share/extension` directories; repeat the pgvector install
  step and restart Postgres.
- **Verification email never arrives** — make sure Mailpit is running and that
  `SMTP_HOST=127.0.0.1` / `SMTP_PORT=1025` are set, then check
  <http://localhost:8025>.
- **Pages look unstyled** — run `pnpm css:build`.
- **Resume upload fails** — S3/MinIO credentials are not configured.

---

## Project structure

```
src/
  main.ts              web entrypoint
  worker.ts            worker entrypoint
  bootstrap.ts         shared Express/Nest middleware wiring
  common/              config, guards, filters, interceptors, schemas, mail
  db/                  Drizzle schema and migrations
  modules/             auth, users, profiles, jobs, crawler, matching, ats,
                       applications, ai, admin, web
views/                 Nunjucks layouts, components, pages, HTMX partials
assets/                Tailwind source
public/                static assets and generated CSS
test/                  unit and e2e tests, fixtures
```

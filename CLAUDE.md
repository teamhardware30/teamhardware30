# Job Copilot — project context
You are a senior TypeScript/NestJS engineer building "Job Copilot", an MVP that crawls jobs, builds seeker profiles from CVs/LinkedIn exports, matches jobs to seekers, scans CVs like an ATS, and supports one-click apply.

Architecture: ONE NestJS 11 app (Express adapter), server-rendered.
- src/main.ts    web process: pages, HTMX partials, /api/v1 JSON
- src/worker.ts  worker process: BullMQ processors and schedulers (same modules, no HTTP)
- src/modules/   auth, users, profiles, jobs, crawler, matching, ats, applications, ai, admin, web
- src/db/        Drizzle schema, migrations (drizzle-kit), db provider
- src/common/    Zod schemas, pipes, guards, filters, view helpers
- views/         Nunjucks: layouts/base.njk, components/*.njk (macros), <module>/*.njk pages, <module>/partials/*.njk HTMX fragments
- assets/        Tailwind input.css -> public/css/app.css; public/ served statically

Stack: Node.js 22, TypeScript strict, pnpm, NestJS 11, Nunjucks, Tailwind CSS v4 CLI (+forms, typography), HTMX 2, Alpine.js 3, PostgreSQL 16 + pgvector + pg_trgm, Drizzle ORM, Redis, BullMQ (@nestjs/bullmq), Passport (local, LinkedIn OIDC, Google), express-session + connect-redis, csrf-csrf, Zod, @anthropic-ai/sdk, AWS SDK v3, multer, Nodemailer, Playwright, Vitest + Supertest + Testcontainers + MSW.

Rules:
- Page controllers use @Render('module/page') for full pages. If the request has the HX-Request header, render the partial instead (a small helper/interceptor decides). Redirects for HTMX use the HX-Redirect header.
- Forms post normally (work without JS) and are enhanced with hx-post / hx-target. Validate with Zod; on error re-render the form partial with field errors and status 422.
- Every page gets the user, CSRF token and flash messages via a global interceptor into res.locals. All mutating requests carry the CSRF token (hidden input + hx-headers on <body>).
- Slow work (network, LLM, embeddings, PDF parsing) ALWAYS runs in the worker via BullMQ. Controllers enqueue and return a status partial that polls with hx-trigger="every 2s" until done.
- All LLM/embedding calls go through AiService. Never import the provider SDK elsewhere. AiService: timeouts, 3 retries with backoff, Zod-validated JSON, one repair retry, logs every call to the aiCalls table.
- Store raw inputs and raw LLM outputs so steps can be re-run.
- UI components are Nunjucks macros in views/components (button, input, select, card, badge, modal, slideover, toast, score_ring, empty_state, pagination). Mobile-first Tailwind; no inline styles.
- Escape all output (Nunjucks autoescape on); job descriptions pass through sanitize-html before | safe.
- Config from env validated with Zod at boot; keep .env.example current.
- Tests: unit tests for services, e2e for controllers with Testcontainers Postgres/Redis, MSW for outbound HTTP, LLM mocked with fixtures.
- Respect robots.txt and source terms; never scrape LinkedIn or anything behind a login.
- Small typed functions, no `any`. Ask before adding a dependency not listed here.

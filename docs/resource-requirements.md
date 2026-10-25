# Resource Requirements

This document lists implemented Job Copilot features that require external
services, credentials, binaries, or infrastructure before they work in a live
environment. Core browsing, crawling, matching, ATS, and application code can run
without all of these, but the listed features degrade or fail until the resource
is configured.

## Required for all deployments

| Resource | Used by | Notes |
|---|---|---|
| Node.js 22+ and pnpm 9 | Entire app | Build and runtime |
| PostgreSQL 16 with `vector` and `pg_trgm` | Database, search, embeddings | Required |
| Redis 6.2+ | Sessions, queues, throttling, crawler cache | Required |

## Required for authentication email flows

| Resource | Used by | Notes |
|---|---|---|
| SMTP server | Email verification, password/apply email flows | Mailpit works locally on `127.0.0.1:1025` |

## Required for CV parsing and AI features

| Resource | Used by | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | CV parsing, job enrichment, ATS review, cover letters, tailoring, explanations | Without it, AI-backed parsing and writing fail |
| `EMBEDDING_API_KEY` with `EMBEDDING_PROVIDER=voyage` | Profile and job embeddings | Set `EMBEDDING_PROVIDER=none` to disable embeddings |

## Required for resume uploads and generated CVs

| Resource | Used by | Notes |
|---|---|---|
| S3-compatible storage | Resume uploads, generated tailored CVs | MinIO works locally; configure `S3_ENDPOINT`, `S3_BUCKET`, and credentials |
| Playwright Chromium | Tailored CV PDF generation | Install with `npx playwright install chromium` |

## Optional integrations

| Resource | Used by | Notes |
|---|---|---|
| Google OAuth credentials | Google login | Optional |
| LinkedIn OIDC credentials | LinkedIn login | Optional |
| ClamAV (`clamscan`) | Upload malware scanning | Optional unless `CLAMAV_REQUIRED=true` |
| Sentry DSN | Error reporting | Optional |
| Docker daemon | Testcontainers e2e tests and Compose services | Required only for those workflows |

## Crawler legal and operational requirements

- Each enabled source must be reviewed for terms of service and `robots.txt`.
- Remotive is seeded disabled because its robots file disallows `/api/*`.
- Source contact email and rate limits are configured through environment variables.
- At least six legally approved sources and 5,000 active jobs are needed for the MVP gate.

## Current local status

- PostgreSQL, Redis, and Mailpit are available through Docker Compose.
- MinIO may require Docker Hub authentication in some environments.
- AI parsing is disabled until `ANTHROPIC_API_KEY` is set.
- Embeddings are disabled when `EMBEDDING_PROVIDER=none`.

# Admin Guide

## Access
Set `users.role = 'admin'` in the database.

## Sources
- Open `/admin/sources`.
- Enable or disable sources.
- Trigger **Run now**.
- Use `/admin/crawl-runs` to inspect recent crawl history.

## Enrichment
- Open `/admin/enrichment`.
- Re-enrich one job by ID.
- Re-enrich a bounded date range.

## Queues and health
- Bull Board is available at `/admin/queues` in read-only mode.
- `/healthz` checks PostgreSQL and Redis.
- `/admin/health` summarizes source health and AI usage when implemented.

## Notes
- Scheduler registration happens in the worker process.
- Keep `CRAWLER_RESPECT_ROBOTS=true` unless you own the source.
- Review enabled sources for legal and robots.txt compliance before launch.

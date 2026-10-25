export const CRAWLER_REDIS = Symbol('CRAWLER_REDIS');

export const CRAWL_SOURCE_QUEUE = 'crawl-source';
export const UPSERT_JOBS_QUEUE = 'upsert-jobs';
export const DEDUPE_QUEUE = 'dedupe';
export const ENRICH_JOB_QUEUE = 'enrich-job';
export const MAINTENANCE_QUEUE = 'maintenance';

export const CRAWL_SOURCE_JOB = 'crawl-source';
export const DEACTIVATE_STALE_JOB = 'deactivate-stale-jobs';

/** Jobs are written in batches so a single BullMQ payload stays small. */
export const UPSERT_BATCH_SIZE = 100;

/** Jobs not seen for this many days are deactivated by the nightly job. */
export const STALE_AFTER_DAYS = 7;

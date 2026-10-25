CREATE TYPE "public"."source_kind" AS ENUM('greenhouse', 'lever', 'ashby', 'remotive', 'arbeitnow', 'jsonld', 'html');--> statement-breakpoint
CREATE TYPE "public"."crawl_run_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."apply_method" AS ENUM('onsite', 'email', 'external_ats');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"domain" text,
	"website_url" text,
	"logo_url" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"base_url" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cron" text DEFAULT '0 */6 * * *' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_status" text,
	"last_run_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crawl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "crawl_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"jobs_found" integer DEFAULT 0 NOT NULL,
	"jobs_created" integer DEFAULT 0 NOT NULL,
	"jobs_updated" integer DEFAULT 0 NOT NULL,
	"jobs_skipped" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_source_url_unique";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN IF EXISTS "source_name";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN IF EXISTS "status";--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "embedding" TYPE vector(1024);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "apply_url" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "remote" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "employment_type" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_min" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_max" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_currency" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_period" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "apply_method" "apply_method" DEFAULT 'external_ats' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "apply_email" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(company, '') || ' ' || coalesce(description_text, ''))) STORED;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "jobs" SET "fingerprint" = md5(coalesce("source_url", "id"::text)) WHERE "fingerprint" IS NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "fingerprint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_fingerprint_unique" UNIQUE("fingerprint");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_runs_source_started_idx" ON "crawl_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_source_external_unique" ON "jobs" USING btree ("source_id","external_id") WHERE "jobs"."external_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_search_vector_idx" ON "jobs" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_embedding_idx" ON "jobs" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_title_trgm_idx" ON "jobs" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_company_idx" ON "jobs" USING btree ("company");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_active_posted_idx" ON "jobs" USING btree ("is_active","posted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_source_idx" ON "jobs" USING btree ("source_id");

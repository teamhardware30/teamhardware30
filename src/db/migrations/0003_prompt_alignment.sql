CREATE OR REPLACE FUNCTION public.uuid_v7() RETURNS uuid AS $$
DECLARE
  timestamp_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  uuid_bytes bytea;
BEGIN
  uuid_bytes := substring(int8send(timestamp_ms) from 3 for 6) || gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql;

CREATE TYPE "public"."resume_source" AS ENUM('upload', 'linkedin_pdf', 'linkedin_zip', 'generated');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('new', 'saved', 'hidden', 'applied');--> statement-breakpoint
CREATE TYPE "public"."application_channel" AS ENUM('onsite', 'email', 'external_ats');--> statement-breakpoint
ALTER TABLE "ats_scans" DROP CONSTRAINT "ats_scans_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "seeker_profiles" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "experiences" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "educations" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "profile_skills" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "skills" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "resumes" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "ats_scans" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "ats_scans" ALTER COLUMN "job_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "id" SET DEFAULT public.uuid_v7();--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "seeker_profiles" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "seeker_profiles" ADD COLUMN "remote_pref" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "seeker_profiles" ADD COLUMN "years_experience" integer;--> statement-breakpoint
ALTER TABLE "seeker_profiles" ADD COLUMN "seniority" text;--> statement-breakpoint
ALTER TABLE "seeker_profiles" ADD COLUMN "open_to_relocate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "seeker_profiles" ADD COLUMN "onboarding_step" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "seeker_profiles" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seeker_profiles" ADD COLUMN "last_matches_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seeker_profiles" ADD COLUMN "embedding_text_hash" text;--> statement-breakpoint
ALTER TABLE "seeker_profiles" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "bullets" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "educations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD COLUMN "level" text;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD COLUMN "years" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "source" "resume_source" DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "parsed_json" jsonb;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "parse_status" text;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "parse_error" text;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "normalized_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "ats_type" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "kill_switch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD COLUMN "batches_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD COLUMN "batches_completed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD COLUMN "processed_upsert_batches" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD COLUMN "processed_dedupe_batches" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD COLUMN "error_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD COLUMN "errors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "explanation" jsonb;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "status" "match_status" DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "computed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ats_scans" ADD COLUMN "resume_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ats_scans" ADD COLUMN "keyword_hits" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ats_scans" ADD COLUMN "keyword_gaps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ats_scans" ADD COLUMN "format_issues" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ats_scans" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "resume_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "channel" "application_channel" NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "answers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "events" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "prompt_name" text;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "success" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "cost_usd" numeric(12, 6);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ats_scans" ADD CONSTRAINT "ats_scans_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ats_scans" ADD CONSTRAINT "ats_scans_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_matches_profile_score_idx" ON "matches" USING btree ("profile_id","score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ats_scans_profile_created_idx" ON "ats_scans" USING btree ("profile_id","created_at");--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN IF EXISTS "reasons";--> statement-breakpoint
ALTER TABLE "ats_scans" DROP COLUMN IF EXISTS "matched_keywords";--> statement-breakpoint
ALTER TABLE "ats_scans" DROP COLUMN IF EXISTS "missing_keywords";--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_profile_id_job_id_unique" UNIQUE("profile_id","job_id");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "job_matches_score_range" CHECK ("matches"."score" between 0 and 100);--> statement-breakpoint
ALTER TABLE "public"."users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
UPDATE "users" SET "role" = 'seeker' WHERE "role" = 'user';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'seeker';--> statement-breakpoint
ALTER TABLE "public"."applications" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
UPDATE "applications" SET "status" = 'draft' WHERE "status" = 'queued';--> statement-breakpoint
DROP TYPE "public"."application_status";--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('draft', 'submitted', 'failed', 'viewed', 'interview', 'rejected', 'offer');--> statement-breakpoint
ALTER TABLE "public"."applications" ALTER COLUMN "status" SET DATA TYPE "public"."application_status" USING "status"::"public"."application_status";--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "status" SET DEFAULT 'draft';
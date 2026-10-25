ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "seeker_profiles" ADD COLUMN "apply_consent" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "employer_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "remote_type" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "remote_regions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "seniority" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "required_skills" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "preferred_skills" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "enrichment_source" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_employer_id_users_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP TYPE "public"."user_role";
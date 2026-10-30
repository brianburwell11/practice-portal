ALTER TABLE "app_user" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "terms_accepted_at" timestamp with time zone;
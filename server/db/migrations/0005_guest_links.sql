ALTER TABLE "grant_link" DROP CONSTRAINT "grant_link_scope_check";--> statement-breakpoint
ALTER TABLE "grant_link" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "grant_link" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "grant_link" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "grant_link_one_live_band_link" ON "grant_link" USING btree ("band_id") WHERE "grant_link"."scope" = 'band' and "grant_link"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "grant_link" ADD CONSTRAINT "grant_link_scope_check" CHECK ("grant_link"."scope" in ('band','setlist','song'));
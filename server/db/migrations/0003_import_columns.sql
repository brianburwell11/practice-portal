ALTER TABLE "band" ADD COLUMN "legacy_id" text;--> statement-breakpoint
ALTER TABLE "band" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "setlist" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "song" ADD COLUMN "lyrics" jsonb;--> statement-breakpoint
ALTER TABLE "song" ADD COLUMN "notes" jsonb;--> statement-breakpoint
ALTER TABLE "band" ADD CONSTRAINT "band_legacy_id_unique" UNIQUE("legacy_id");
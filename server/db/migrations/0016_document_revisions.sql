ALTER TABLE "setlist" ADD COLUMN "rev" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "song" ADD COLUMN "config_rev" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "song" ADD COLUMN "lyrics_rev" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "song" ADD COLUMN "chords_rev" integer DEFAULT 1 NOT NULL;
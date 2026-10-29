CREATE TABLE "email_block" (
	"email" "citext" PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invite" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "invite_band_emailed_idx" ON "invite" USING btree ("band_id","emailed_at");--> statement-breakpoint
-- Invites made before this column existed were emailed whenever they had an address.
UPDATE "invite" SET "emailed_at" = "created_at" WHERE "email" IS NOT NULL;

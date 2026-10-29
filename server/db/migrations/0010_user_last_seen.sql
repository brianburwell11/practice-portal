ALTER TABLE "app_user" ADD COLUMN "last_sign_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
-- Start from what live sessions remember; sessions of people who signed out are gone.
UPDATE "app_user" u SET
  "last_sign_in_at" = s.signed_in,
  "last_seen_at" = s.seen
FROM (
  SELECT "user_id", max("created_at") AS signed_in, max("last_seen_at") AS seen
  FROM "session" GROUP BY "user_id"
) s
WHERE s."user_id" = u."id";

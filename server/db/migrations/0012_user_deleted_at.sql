ALTER TABLE "app_user" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
-- Accounts deleted before this column existed: mark them, and clear what the
-- delete didn't yet. Their address is already gone, so invites and audit
-- entries naming it can't be matched here.
UPDATE "app_user" SET
  "deleted_at" = now(),
  "last_sign_in_at" = NULL,
  "terms_version" = NULL,
  "terms_accepted_at" = NULL
WHERE "email" LIKE 'deleted-%@deleted.invalid';

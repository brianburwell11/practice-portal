CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"band_id" uuid NOT NULL,
	"created_by" uuid,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_kind_check" CHECK ("job"."kind" in ('transcode_stem')),
	CONSTRAINT "job_status_check" CHECK ("job"."status" in ('uploading','queued','running','done','failed'))
);
--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_band_id_band_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."band"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_status_idx" ON "job" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "job_band_idx" ON "job" USING btree ("band_id");
CREATE TABLE "mixer_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"band_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mixer_template" ADD CONSTRAINT "mixer_template_band_id_band_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."band"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mixer_template_band_name_unique" ON "mixer_template" USING btree ("band_id",lower("name"));
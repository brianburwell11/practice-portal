CREATE TABLE "machine_uptime" (
	"day" date NOT NULL,
	"machine_id" text NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "machine_uptime_day_machine_id_pk" PRIMARY KEY("day","machine_id")
);
--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "started_at" timestamp with time zone;
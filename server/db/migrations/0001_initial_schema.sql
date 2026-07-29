CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"band_id" uuid,
	"actor_id" uuid,
	"actor_kind" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"diff" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_actor_kind_check" CHECK ("audit_log"."actor_kind" in ('user','grant','system','support'))
);
--> statement-breakpoint
CREATE TABLE "band" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"colors" jsonb NOT NULL,
	"logo_key" text,
	"website" text,
	"palette" jsonb,
	"visibility" text DEFAULT 'private' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "band_slug_unique" UNIQUE("slug"),
	CONSTRAINT "band_visibility_check" CHECK ("band"."visibility" in ('private','public'))
);
--> statement-breakpoint
CREATE TABLE "capability" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grant_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"band_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"target_id" uuid NOT NULL,
	"capabilities" text[] DEFAULT '{song.read}' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "grant_link_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "grant_link_scope_check" CHECK ("grant_link"."scope" in ('setlist','song'))
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"band_id" uuid NOT NULL,
	"email" "citext",
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	CONSTRAINT "invite_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"user_id" uuid NOT NULL,
	"band_id" uuid NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_user_id_band_id_pk" PRIMARY KEY("user_id","band_id")
);
--> statement-breakpoint
CREATE TABLE "org" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer NOT NULL,
	"membership_eligible" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_capability" (
	"role_key" text NOT NULL,
	"capability_key" text NOT NULL,
	CONSTRAINT "role_capability_role_key_capability_key_pk" PRIMARY KEY("role_key","capability_key")
);
--> statement-breakpoint
CREATE TABLE "setlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"band_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "setlist_band_slug_unique" UNIQUE("band_id","slug")
);
--> statement-breakpoint
CREATE TABLE "song" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"band_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"config" jsonb NOT NULL,
	"media_prefix" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "song_band_slug_unique" UNIQUE("band_id","slug")
);
--> statement-breakpoint
CREATE TABLE "user_song_state" (
	"user_id" uuid NOT NULL,
	"song_id" uuid NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "user_song_state_user_id_song_id_pk" PRIMARY KEY("user_id","song_id")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_band_id_band_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."band"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band" ADD CONSTRAINT "band_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band" ADD CONSTRAINT "band_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_link" ADD CONSTRAINT "grant_link_band_id_band_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."band"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_link" ADD CONSTRAINT "grant_link_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_band_id_band_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."band"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_role_role_key_fk" FOREIGN KEY ("role") REFERENCES "public"."role"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_band_id_band_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."band"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_role_role_key_fk" FOREIGN KEY ("role") REFERENCES "public"."role"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_capability" ADD CONSTRAINT "role_capability_role_key_role_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."role"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_capability" ADD CONSTRAINT "role_capability_capability_key_capability_key_fk" FOREIGN KEY ("capability_key") REFERENCES "public"."capability"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setlist" ADD CONSTRAINT "setlist_band_id_band_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."band"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song" ADD CONSTRAINT "song_band_id_band_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."band"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song" ADD CONSTRAINT "song_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_song_state" ADD CONSTRAINT "user_song_state_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_song_state" ADD CONSTRAINT "user_song_state_song_id_song_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."song"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_band_at_idx" ON "audit_log" USING btree ("band_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "band_owner_idx" ON "band" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "grant_link_band_idx" ON "grant_link" USING btree ("band_id");--> statement-breakpoint
CREATE INDEX "invite_band_idx" ON "invite" USING btree ("band_id");--> statement-breakpoint
CREATE INDEX "membership_band_idx" ON "membership" USING btree ("band_id");
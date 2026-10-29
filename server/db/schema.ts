/**
 * Postgres schema — the source of truth for band/song/setlist config once
 * Phase 4 imports the R2 JSON. Media stays in R2; rows hold object keys.
 *
 * Drizzle is both the migration generator and the query layer. Run
 * `npm run db:generate` after editing this file, and commit the generated SQL.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Case-insensitive text, for email. Requires the `citext` extension, which
 * the first migration installs.
 */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// --- Tenancy -----------------------------------------------------------------

/**
 * The Org tier is explicitly out of scope. This table exists only so
 * `band.org_id` can be a real foreign key rather than a loose uuid — it stays
 * empty until a school or a teacher with many ensembles actually shows up.
 */
export const org = pgTable('org', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const appUser = pgTable('app_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  displayName: text('display_name'),
  /**
   * Google's stable account id (the ID token's `sub`). Email can change on a
   * Google account; `sub` can't, so it's what sign-in matches on. Null for a
   * user who has never signed in — e.g. the owner created by the R2 import,
   * who is linked by verified email on first sign-in.
   */
  googleSub: text('google_sub').unique(),
  avatarUrl: text('avatar_url'),
  createdAt: createdAt(),
});

/**
 * A signed-in browser. The cookie holds a random token; only its SHA-256 is
 * stored, so a database leak doesn't hand out live sessions. Expiry is
 * absolute — sliding sessions never end for a device left signed in.
 */
export const session = pgTable('session', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('session_user_idx').on(t.userId),
]);

export interface BandColors {
  primary: string;
  accent: string;
  background: string;
  text: string;
}

export const band = pgTable('band', {
  id: uuid('id').primaryKey().defaultRandom(),
  // The cheap hedge: null today, non-null if the Org tier ever lands. Adding
  // it later would be a migration across every table.
  orgId: uuid('org_id').references(() => org.id),
  slug: text('slug').notNull().unique(),
  /**
   * The pre-Postgres band id (`z17zqzxv`, `dev`). Every R2 key for this band
   * starts with it, and media doesn't move, so it outlives the import. Null
   * for bands created after Phase 4.
   */
  legacyId: text('legacy_id').unique(),
  name: text('name').notNull(),
  /** Order in the band picker — `registry.json` order, which the UI shows as-is. */
  position: integer('position').notNull().default(0),
  colors: jsonb('colors').$type<BandColors>().notNull(),
  /** R2 object key, not a public URL — Phase 7 serves it behind a capability check. */
  logoKey: text('logo_key'),
  website: text('website'),
  palette: jsonb('palette').$type<string[]>(),
  visibility: text('visibility').notNull().default('private'),
  ownerUserId: uuid('owner_user_id').notNull().references(() => appUser.id),
  createdAt: createdAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  check('band_visibility_check', sql`${t.visibility} in ('private','public')`),
  index('band_owner_idx').on(t.ownerUserId),
]);

// --- Roles and capabilities --------------------------------------------------
//
// The capability catalog and the role → capability mapping are rows, not code.
// Splitting Editor into Editor + Producer later is an insert, not a deploy.

export const capability = pgTable('capability', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
});

export const role = pgTable('role', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  /** Display order in the roster UI, most privileged first. */
  sortOrder: integer('sort_order').notNull(),
  /**
   * Whether this role can appear in `membership.role`. False for `owner`
   * (authoritative home is `band.owner_user_id`) and `guest` (a grant-link
   * actor kind, which has no membership row). Postgres can't express this as
   * a check constraint across tables, so the invite/roster code enforces it.
   */
  membershipEligible: boolean('membership_eligible').notNull().default(true),
});

export const roleCapability = pgTable('role_capability', {
  roleKey: text('role_key').notNull().references(() => role.key, { onDelete: 'cascade' }),
  capabilityKey: text('capability_key').notNull().references(() => capability.key, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.roleKey, t.capabilityKey] }),
]);

export const membership = pgTable('membership', {
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  bandId: uuid('band_id').notNull().references(() => band.id, { onDelete: 'cascade' }),
  role: text('role').notNull().references(() => role.key),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.bandId] }),
  index('membership_band_idx').on(t.bandId),
]);

// --- Content -----------------------------------------------------------------

/**
 * Songs belong to the BAND, never to the uploader. `uploadedBy` is attribution
 * only. This is the Shared-Drive lesson: if content belongs to a person, it
 * leaves when they do.
 */
export const song = pgTable('song', {
  id: uuid('id').primaryKey().defaultRandom(),
  bandId: uuid('band_id').notNull().references(() => band.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  /** Validated by `songConfigSchema` before it ever reaches this column. */
  config: jsonb('config').notNull(),
  /** `lyricsDataSchema`. Null when the song has no lyrics file. */
  lyrics: jsonb('lyrics'),
  /**
   * `notesDataSchema` — the band's timestamp notes, written by admins.
   * Personal notes are a different thing and live in `user_song_state`.
   */
  notes: jsonb('notes'),
  /**
   * R2 prefix holding this song's audio and score objects, e.g.
   * `dev/songs/8xDKlqH`. Media does not move in Phase 4, so the legacy
   * id-based prefix has to survive as a reference even after a slug rename.
   */
  mediaPrefix: text('media_prefix'),
  uploadedBy: uuid('uploaded_by').references(() => appUser.id),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  unique('song_band_slug_unique').on(t.bandId, t.slug),
]);

export const setlist = pgTable('setlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  bandId: uuid('band_id').notNull().references(() => band.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  /** Order in the band's setlist menu — `setlists/index.json` order, shown as-is. */
  position: integer('position').notNull().default(0),
  config: jsonb('config').notNull(),
  createdAt: createdAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  unique('setlist_band_slug_unique').on(t.bandId, t.slug),
]);

/**
 * Per-user private layer: personal notes, mixer state, loop points.
 * Always writable by its owner, no capability check.
 */
export const userSongState = pgTable('user_song_state', {
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  songId: uuid('song_id').notNull().references(() => song.id, { onDelete: 'cascade' }),
  state: jsonb('state').notNull().default({}),
}, (t) => [
  primaryKey({ columns: [t.userId, t.songId] }),
]);

// --- Access ------------------------------------------------------------------

export const invite = pgTable('invite', {
  id: uuid('id').primaryKey().defaultRandom(),
  bandId: uuid('band_id').notNull().references(() => band.id, { onDelete: 'cascade' }),
  /** When set, only a Google account with this verified email can accept. */
  email: citext('email'),
  role: text('role').notNull().references(() => role.key),
  /** Only the hash is stored; the token itself exists solely in the emailed link. */
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedBy: uuid('accepted_by').references(() => appUser.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => appUser.id),
  createdAt: createdAt(),
}, (t) => [
  index('invite_band_idx').on(t.bandId),
]);

/**
 * Background work (Phase 9) — today, transcoding one uploaded stem. The
 * browser uploads the raw file straight to R2 (`uploading`), says so
 * (`queued`), and the in-process worker claims one job at a time with
 * `FOR UPDATE SKIP LOCKED` (`running`), heartbeating `locked_at` as it
 * reports progress, until `done` or, after its retries, `failed`.
 */
export const job = pgTable('job', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  bandId: uuid('band_id').notNull().references(() => band.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').references(() => appUser.id, { onDelete: 'set null' }),
  /** What the kind needs — for `transcode_stem`: song, stem id, raw key, original name, normalize. */
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('uploading'),
  attempts: integer('attempts').notNull().default(0),
  /** 0–1, while running. */
  progress: real('progress').notNull().default(0),
  error: text('error'),
  /** What it produced — for `transcode_stem`: the `.opus` file name. */
  result: jsonb('result'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** Set when claimed and on every progress write; a stale one means the worker died. */
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  check('job_kind_check', sql`${t.kind} in ('transcode_stem')`),
  check('job_status_check', sql`${t.status} in ('uploading','queued','running','done','failed')`),
  index('job_status_idx').on(t.status, t.createdAt),
  index('job_band_idx').on(t.bandId),
]);

/**
 * A signed-in non-member asking to join a Members-only band. The Owner is
 * emailed; an Owner or Manager approves (joins as Member) or declines, and the
 * requester is emailed either way. One pending request per person per band.
 */
export const accessRequest = pgTable('access_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  bandId: uuid('band_id').notNull().references(() => band.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  /** Optional note to the band, as typed. */
  message: text('message'),
  status: text('status').notNull().default('pending'),
  createdAt: createdAt(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: uuid('decided_by').references(() => appUser.id, { onDelete: 'set null' }),
}, (t) => [
  check('access_request_status_check', sql`${t.status} in ('pending','approved','declined')`),
  index('access_request_band_idx').on(t.bandId),
  uniqueIndex('access_request_one_pending').on(t.bandId, t.userId).where(sql`${t.status} = 'pending'`),
]);

/**
 * Guest access for subs and deps: needs no account, consumes no seat.
 *
 * Phase 10 uses `scope = 'band'`: one "anyone with the link" link per band,
 * read-only, optionally expiring, replaced by Reset and ended by turning it
 * off (`revoked_at`). Owners and Managers can copy it again at any time, so
 * the token is stored as well as its hash; lookups go by the hash.
 *
 * `targetId` is polymorphic on `scope`, so it carries no foreign key.
 */
export const grantLink = pgTable('grant_link', {
  id: uuid('id').primaryKey().defaultRandom(),
  bandId: uuid('band_id').notNull().references(() => band.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  targetId: uuid('target_id').notNull(),
  capabilities: text('capabilities').array().notNull().default(sql`'{song.read}'`),
  /** The link's secret, kept so the link can be shown again. Revoked links clear it. */
  token: text('token'),
  tokenHash: text('token_hash').notNull().unique(),
  /** Null: no expiry — it lasts until reset or turned off. */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => appUser.id),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  check('grant_link_scope_check', sql`${t.scope} in ('band','setlist','song')`),
  index('grant_link_band_idx').on(t.bandId),
  // At most one live band link: Reset revokes the old one in the same transaction.
  uniqueIndex('grant_link_one_live_band_link').on(t.bandId).where(sql`${t.scope} = 'band' and ${t.revokedAt} is null`),
]);

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  bandId: uuid('band_id').references(() => band.id, { onDelete: 'set null' }),
  actorId: uuid('actor_id').references(() => appUser.id),
  /** user | grant | system | support */
  actorKind: text('actor_kind').notNull().default('user'),
  /** e.g. 'song.timing.write' */
  action: text('action').notNull(),
  target: text('target'),
  diff: jsonb('diff'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('audit_log_actor_kind_check', sql`${t.actorKind} in ('user','grant','system','support')`),
  index('audit_log_band_at_idx').on(t.bandId, t.at.desc()),
]);

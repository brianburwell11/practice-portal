---
title: "Multi-User Server Architecture — Phased Plan"
description: "Turning the practice portal from a localhost-admin SPA into a hosted multi-band product: extracting the write API out of the Vite plugin, moving config into Postgres, adding accounts, four band roles plus expiring sub links, private media, and a server-side song-prep pipeline."
pubDate: "Jul 27 2026"
tags: ["architecture", "backend", "auth", "permissions", "infrastructure", "plan"]
---

# Multi-User Server Architecture — Phased Plan

Companion to the **Roles & Permissions** reference sheet (`practice-portal-roles.pdf`), which holds the full capability matrix, and follow-up to **Cloudflare Pages Migration**. That migration moves the *host*; this plan crosses the line that migration explicitly declined to cross — adding a backend, accounts, and admin-in-production.

**The core problem.** Every write in this app lives in `vite-plugin-config-api.ts`, a ~1000-line Vite dev middleware. R2 credentials come from `.env` and never leave localhost. The admin UI is gated on `import.meta.env.DEV`, so it isn't in the production bundle at all. Adding a song currently requires Brian's laptop, `ffmpeg`, and a local MuseScore 4 install. "Other people can add songs" means all four of those facts have to change.

---

## Assumptions

These were recommendations, not yet explicitly confirmed. Flag any you'd diverge on before Phase 2 — Phase 1 is safe either way.

| Decision | Choice | Consequence if wrong |
|---|---|---|
| Access model | Invite-only bands, no open signup | Low — signup is additive later |
| Host | Node in Docker on Fly.io | Medium — Workers-only would force dropping server-side `.mscz` |
| Config store | Postgres source of truth; media stays in R2 | High — this is the migration; changing later means redoing Phase 4 |
| Prep pipeline | Full server-side, async jobs | Medium — affects container sizing and the wizard's UX |
| Roles | Owner (billing/transfer) + Manager, Editor, Member + expiring guest grants | Low — capabilities are checked individually, so bundles can be re-cut |

**Rough cost at your scale** (a handful of bands, a few hundred songs): Fly.io shared-CPU machine with a volume ~\$5–10/mo, managed Postgres ~\$0–20/mo (Fly Postgres or Neon free tier is plenty at first), R2 storage ~\$0.015/GB/mo with no egress fees. Call it **under \$30/mo** until real traffic shows up.

---

## Phase 1 — Extract the API core from the Vite plugin

The keystone. `vite-plugin-config-api.ts` becomes a thin adapter over a portable handler module, so the *same* code serves both the Vite dev middleware and the new server. No behavior change, no production impact, and it makes every later phase incremental instead of a big-bang rewrite.

- [x] Create `server/core/` with framework-agnostic handlers — plain `(input) => Promise<result>` functions, no `req`/`res`, no Vite imports.
- [x] Move the R2 client, `ffmpeg` helpers (`loudnorm` two-pass, Opus transcode) and `resolveMscoreBin()` into `server/core/media/`.
- [x] Port each existing route to a core handler. Current surface, all of which needs a home:
  - [x] `POST /api/bands/:bandId/songs/:songId/config`
  - [x] `POST /api/bands/:bandId/songs/:songId/lyrics`
  - [x] `POST /api/bands/:bandId/songs/:songId/notes`
  - [x] `POST /api/bands/:bandId/songs/:songId/rename`
  - [x] `POST /api/bands/:bandId/logo`
  - [x] `POST /api/r2/transcode-upload/:bandId/:songId`
  - [x] `POST /api/r2/mscz-convert-upload/:bandId/:songId`
  - [x] `POST /api/r2/presign`
  - [x] `POST /api/registry/rebuild`
  - [x] `GET /api/bands/:bandId/storage`
  - [x] `PUT /api/bands/:bandId` · `DELETE /api/bands/:bandId`
  - [x] `POST /api/bands/:bandId/songs/discography`
  - [x] `DELETE /api/bands/:bandId/songs/:songId`
  - [x] `DELETE /api/bands/:bandId/songs/:songId/file/:filename`
  - [x] `POST /api/bands/:bandId/setlists/:setlistId` · `DELETE` same
- [x] Rewrite `vite-plugin-config-api.ts` as a router that parses the request and calls core handlers. Target: under 200 lines.
- [x] Verify the full local admin flow still works unchanged — add a song end to end, edit a tapMap, save lyrics, delete a song.

**Exit criteria**: local admin is byte-for-byte equivalent in behavior, and the plugin contains no business logic.

### What landed

```
server/core/
  types.ts            CoreRequest / CoreResponse / RouteDef contract
  http.ts             HttpError, ok(), json()
  router.ts           matchRoute() + runRoute()
  routes.ts           the 17-route table, as data
  r2.ts               R2 client and object helpers
  setlistEntries.ts   the rename/delete setlist cascade
  media/ffmpeg.ts     ffprobe, two-pass loudnorm, Opus transcode
  media/musescore.ts  resolveMscoreBin(), convertScore()
  handlers/           songs · bands · setlists · uploads
server/adapters/
  nodeRequest.ts      body reading + multipart→disk, shared by any Node host
vite-plugin-config-api.ts   77 lines, no business logic
```

Two things worth carrying into later phases:

- **The route table is data.** Method, pattern, body kind, upload limits, and error mapping all live in `routes.ts`. Phase 6's required capability is a field on the same rows, and the "every write route declares a capability" test is a loop over that array.
- **`precheck` runs before the body is read.** Routes can reject on path/query/config alone — the `.mscz` filename check and the R2-credentials check use it, so a bad request doesn't first stream 50 MB to disk. Phase 6's capability check belongs here for the same reason: authorization should not require reading the upload.

Verified against real R2 with real `ffmpeg` and MuseScore 4: 22 steps / 47 assertions covering every route, including the rename and delete cascades into `discography.json` and setlists. The `dev` band finished byte-for-byte identical to its starting state (49 objects, 77,703,623 bytes).

---

## Phase 2 — Data model in Postgres

Schema first, before any server code, because the roles design constrains it. Memberships, invites, and revocable grants all need transactional storage — this is what rules out JSON-in-R2 as source of truth.

- [ ] Provision Postgres (Fly Postgres or Neon).
- [ ] Pick a migration tool and a query layer (Drizzle fits the existing TypeScript/Zod setup well).
- [ ] Write the initial schema:

```sql
create table app_user (
  id            uuid primary key default gen_random_uuid(),
  email         citext unique not null,
  display_name  text,
  created_at    timestamptz not null default now()
);

-- org_id is the cheap hedge: null today, non-null if a school or teacher
-- with many ensembles ever shows up. Adding it later is a migration
-- across every table.
create table band (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references org(id),
  slug          text unique not null,
  name          text not null,
  colors        jsonb not null,
  logo_key      text,
  website       text,
  palette       jsonb,
  visibility    text not null default 'private'
                  check (visibility in ('private','public')),
  owner_user_id uuid not null references app_user(id),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table membership (
  user_id  uuid not null references app_user(id) on delete cascade,
  band_id  uuid not null references band(id) on delete cascade,
  role     text not null check (role in ('manager','editor','member')),
  joined_at timestamptz not null default now(),
  primary key (user_id, band_id)
);

-- Songs belong to the BAND, never to the uploader. uploaded_by is
-- attribution only. This is the Shared-Drive lesson: if content belongs
-- to a person, it leaves when they do.
create table song (
  id            uuid primary key default gen_random_uuid(),
  band_id       uuid not null references band(id) on delete cascade,
  slug          text not null,
  title         text not null,
  artist        text not null,
  config        jsonb not null,          -- validated by songConfigSchema
  uploaded_by   uuid references app_user(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (band_id, slug)
);

create table setlist (
  id       uuid primary key default gen_random_uuid(),
  band_id  uuid not null references band(id) on delete cascade,
  slug     text not null,
  name     text not null,
  config   jsonb not null,
  deleted_at timestamptz,
  unique (band_id, slug)
);

-- Per-user private layer: personal notes, mixer state, loop points.
-- Always writable by its owner, no capability check.
create table user_song_state (
  user_id uuid not null references app_user(id) on delete cascade,
  song_id uuid not null references song(id) on delete cascade,
  state   jsonb not null default '{}',
  primary key (user_id, song_id)
);

create table invite (
  id         uuid primary key default gen_random_uuid(),
  band_id    uuid not null references band(id) on delete cascade,
  email      citext,
  role       text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid not null references app_user(id)
);

-- Guest access for subs and deps: scoped to a setlist, time-boxed,
-- individually revocable, consumes no seat, needs no account.
create table grant_link (
  id           uuid primary key default gen_random_uuid(),
  band_id      uuid not null references band(id) on delete cascade,
  scope        text not null check (scope in ('setlist','song')),
  target_id    uuid not null,
  capabilities text[] not null default '{song.read}',
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_by   uuid not null references app_user(id),
  last_used_at timestamptz
);

create table audit_log (
  id         bigserial primary key,
  band_id    uuid references band(id) on delete set null,
  actor_id   uuid references app_user(id),
  actor_kind text not null default 'user',   -- user | grant | system | support
  action     text not null,                  -- e.g. 'song.timing.write'
  target     text,
  diff       jsonb,
  at         timestamptz not null default now()
);
```

- [ ] Define the capability catalog as data, not code — one table or one constant, listing every capability string (`band.settings`, `song.create`, `song.delete`, `song.audio.write`, `song.timing.write`, `song.score.write`, `song.content.write`, `setlist.write`, `song.read`, `audio.download`, `member.invite`, `member.role.set`, `band.publish`, `band.transfer`, `band.billing`, `band.delete`).
- [ ] Map roles to capability bundles in that same data. Splitting Editor into Editor + Producer later must be a row change, never a code change.

**Exit criteria**: migrations run clean; capability catalog and role bundles are queryable data.

---

## Phase 3 — The server and its container

- [ ] Scaffold the API server (Hono or Fastify — both are light and TypeScript-native) mounting the Phase 1 core handlers.
- [ ] Write the `Dockerfile`: Node 22 base, then `ffmpeg` and **MuseScore** installed in the image. MuseScore needs Qt and a virtual display — expect `xvfb-run` plus a headless-friendly invocation, and budget real time for this step. It is the least predictable part of the whole plan.
- [ ] Verify in-container: `ffmpeg -version`, and an actual `.mscz` → `.mxl` conversion of a real file from the repo.
- [ ] Add a `/healthz` endpoint and a smoke-test script.
- [ ] Deploy to Fly.io with a volume for scratch space; wire R2 credentials as Fly secrets.
- [ ] Keep the API on a subdomain (`api.<domain>`) with the SPA still on Cloudflare Pages.

**Exit criteria**: deployed container converts a real `.mscz` and transcodes a real stem, driven by curl. Still no auth — not yet public-facing.

---

## Phase 4 — Migrate R2 JSON into Postgres

- [ ] Write `scripts/import-r2-to-postgres.ts` with a `--dry-run` flag, following the pattern already established in `scripts/migrate-config-to-r2.ts`.
- [ ] Walk `bands.json` → each `band.json` → each song `config.json` → each setlist, validating every record against the existing Zod schemas on the way in. Schema violations should fail loudly rather than be coerced.
- [ ] Media stays exactly where it is. Only JSON moves; store R2 object keys as references.
- [ ] Verify: row counts match file counts, and a diff of `config` jsonb against the source JSON is empty for every song.
- [ ] Serve reads from the API with ETag and cache headers (`GET /api/bands/:slug/songs/:slug/config`), Cloudflare caching in front.
- [ ] Dual-read period: keep the R2 JSON files in place, untouched, as a rollback path.

**Exit criteria**: the SPA runs entirely off API reads, with R2 JSON still present but unread.

---

## Phase 5 — Accounts, memberships, invites

- [ ] Pick auth. **Magic links** are the recommendation — no passwords to store or reset, and band members are an email-reachable audience. Add Google OAuth later if signup friction shows up.
- [ ] Sessions as httpOnly, Secure, SameSite=Lax cookies scoped to the API subdomain. Rotate on login, and set a sensible absolute expiry.
- [ ] Invite flow: Manager creates an invite → emailed link → acceptance creates the `membership` row. Store only the token hash.
- [ ] Roster UI: list members, change roles, remove members.
- [ ] Ownership transfer as a first-class action (Owner only), plus **multiple Managers allowed** so a band isn't locked out when the Owner stops answering texts.
- [ ] Rate-limit magic-link requests and invite creation.

**Exit criteria**: a second real person can sign in, appear in a band roster, and see only bands they belong to.

---

## Phase 6 — Authorization on every write

- [ ] Implement `can(actor, capability, bandId)` resolving through membership → role → capability bundle, with grant-links handled as a separate actor kind.
- [ ] Wrap every core handler with its required capability. Default deny: a handler with no declared capability must fail closed, not open.
- [ ] Add a test that enumerates the route table and asserts every write route declares a capability — this is the check that stops the surface from drifting as features get added.
- [ ] Scope every query by `band_id` from the session, never from a client-supplied parameter. This is the tenant-isolation bug class; treat path params as untrusted.
- [ ] Write the audit-log entry inside the same transaction as the write.

**Exit criteria**: an Editor is provably blocked from deleting a song and from touching timing data; an unauthenticated request gets nothing.

---

## Phase 7 — Private media

**This phase is load-bearing and easy to overlook.** Audio currently lives on a public R2 URL (`VITE_R2_PUBLIC_URL`) — anyone with the URL can fetch anything. The moment bands are private and multi-tenant, a public bucket contradicts the entire access model.

- [ ] Stop serving media from the public r2.dev URL.
- [ ] Add `GET /api/songs/:id/media/:key` that checks capability, then issues a short-TTL presigned R2 GET and redirects.
- [ ] Confirm presigned URLs survive the audio path: range requests for streaming, the `AudioEngine` fetch/decode flow, and `Cache-Control: immutable` browser caching. Pick a TTL long enough that a long rehearsal doesn't expire mid-song.
- [ ] Verify sheet-music (`.mxl`) and logo fetches go through the same gate.
- [ ] Tighten R2 CORS and remove public bucket access once nothing reads it.

**Exit criteria**: no media object is reachable without a capability check; playback, seeking, and sheet music all still work.

---

## Phase 8 — Admin UI in production

- [ ] Replace every `import.meta.env.DEV` gate with capability checks driven by the session. Affected: `src/main.tsx`, `src/App.tsx`, `src/admin/AdminRibbon.tsx`, `src/components/band/BandPicker.tsx`, `src/components/mixer/MixerPanel.tsx`, `src/components/notes/NotesLayer.tsx`, `src/hooks/useNotesKeyboard.ts`.
- [ ] Keep admin routes lazy-loaded, so Members don't download the wizard bundle.
- [ ] Treat client-side gating as UX only — the server is the enforcement boundary.
- [ ] Empty and unauthorized states: what a Member sees where an Editor sees a control.

**Exit criteria**: a Manager can prep a song entirely from the hosted site, no laptop involved.

---

## Phase 9 — Async prep pipeline

Song prep takes minutes and shells out to native binaries. It cannot run inside a request.

- [ ] Add a job queue (Postgres-backed is plenty at this scale — `pgboss`, or a simple `job` table with `SKIP LOCKED`; no Redis needed yet).
- [ ] Job types: `transcode_stem`, `normalize_loudness`, `convert_score`, `probe_duration`.
- [ ] Direct-to-R2 uploads via presigned PUT so large raw WAV/FLAC never proxies through the API.
- [ ] Job status endpoint plus progress UI in the wizard; the existing `StemsStep` and `ReviewStep` need real progress states.
- [ ] Retries with backoff, a dead-letter state, and per-band concurrency caps so one big upload can't starve everyone.
- [ ] Address `TODO.md` #9 properly: orphan cleanup for failed partial uploads, which becomes much more likely with strangers uploading.
- [ ] Enforce per-band storage quotas at upload time.

**Exit criteria**: a non-technical band member uploads raw WAVs and a `.mscz` from a browser and gets a working song.

---

## Phase 10 — Guest links for subs

The feature most likely to matter to working bands, and confirmed as a real need.

- [ ] Create/revoke UI: pick a setlist, set an expiry, get a link.
- [ ] Grant-link resolution as its own actor kind — no account, capabilities strictly limited to reading and playing the scoped setlist.
- [ ] Default expiry on the order of days, hard maximum enforced server-side.
- [ ] Optional download toggle, defaulting to off.
- [ ] Show last-used time in the UI, and support one-click revoke.
- [ ] Guests still get a private layer keyed to their link session, so a sub can take their own notes.

**Exit criteria**: a sub opens a link with no account, plays Friday's setlist, and loses access when it expires or is revoked.

---

## Phase 11 — Personal layer, safety rails, ops

- [ ] Migrate personal notes from `localStorage` to `user_song_state` so they follow a user across devices. Keep a localStorage fallback for guests.
- [ ] Move per-user mixer state, loop points, and tempo prefs into the same store. Split band setlists from a personal "my practice list."
- [ ] Soft-delete plus a retention window for bands and songs; keep R2 objects through the window so a mistake is recoverable.
- [ ] Keep the existing type-the-name confirmation (commit `16ed559`) on destructive actions — roles don't protect against a legitimate Manager's mistake.
- [ ] Automated Postgres backups, with a *tested* restore. An untested backup isn't one.
- [ ] Error tracking, uptime checks, build-failure alerts.
- [ ] A staging environment sharing the container image but not the production database.
- [ ] Support access: if you can impersonate a user, that action gets an `audit_log` row with `actor_kind = 'support'`. Non-negotiable once anyone pays.

**Exit criteria**: personal state follows users across devices; a deleted song is recoverable; a restore has actually been performed.

---

## Rollback

| Phase reached | How to roll back |
|---|---|
| 1 | Pure refactor; `git revert`. Local admin is the only consumer. |
| 2–3 | Nothing user-facing exists yet. Tear down the Fly app and the database. |
| 4 | R2 JSON is still authoritative and untouched — point the SPA back at it. |
| 5–6 | Feature-flag auth off; the site returns to read-only public behavior. |
| 7 | Re-enable public R2 access and revert the media URL helper. Fast, but re-exposes everything. |
| 8–11 | Per-feature flags. Local admin via the Vite plugin keeps working throughout, because Phase 1 kept both adapters on one core. |

The Vite-plugin path staying alive through every phase is the real safety net — your laptop remains a working admin console even if the hosted server is down.

---

## Deliberately not in scope

- **Billing and subscriptions.** Roles carry an Owner with a billing attribute; no payment integration.
- **Open signup.** Invite-only until there's a reason.
- **The Org tier** (schools, teachers with many ensembles). Hedged with a nullable `org_id` and nothing more.
- **Custom user-defined roles.** The permission matrix explodes and nobody asks below a few hundred tenants.
- **Field-level permissions** (the Producer/Editor split). Capability strings are already granular enough to re-cut into a fifth role later.
- **Stem separation** (Demucs and similar). A much heavier GPU-shaped problem; separate project.
- **Rights and takedowns.** Private-by-default and Owner-only publishing are the posture; a real DMCA process is a business question, not an architectural one.

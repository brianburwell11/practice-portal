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

- [x] Provision Postgres — **Neon free tier**. Unblocked 2026-09-14; see *Where it runs* below.
- [x] Pick a migration tool and a query layer (Drizzle fits the existing TypeScript/Zod setup well).
- [x] Write the initial schema:

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

- [x] Define the capability catalog as data, not code — one table or one constant, listing every capability string (`band.settings`, `song.create`, `song.delete`, `song.audio.write`, `song.timing.write`, `song.score.write`, `song.content.write`, `setlist.write`, `song.read`, `audio.download`, `member.invite`, `member.role.set`, `band.publish`, `band.transfer`, `band.billing`, `band.delete`).
- [x] Map roles to capability bundles in that same data. Splitting Editor into Editor + Producer later must be a row change, never a code change.

**Exit criteria**: migrations run clean; capability catalog and role bundles are queryable data.

### What landed

```
server/db/
  schema.ts        Drizzle schema — 13 tables
  capabilities.ts  typed capability catalog + role bundles (the seed source)
  client.ts        postgres.js pool behind DATABASE_URL
  migrations/
    0000_extensions.sql               create extension citext
    0001_initial_schema.sql           generated from schema.ts
    0002_seed_roles_and_capabilities.sql   generated from capabilities.ts
drizzle.config.ts
scripts/gen-seed-migration.ts   emits 0002 (has a --check mode)
scripts/verify-db.ts            applies migrations to PGlite and asserts behavior
```

| Script | Does |
|---|---|
| `npm run db:generate` | regenerate SQL after editing `schema.ts` |
| `npm run db:seed:gen` | regenerate `0002` after editing `capabilities.ts` |
| `npm run db:verify` | offline: seed file is current + all migrations apply + 46 assertions |
| `npm run db:verify:remote` | the same 46 assertions against `DATABASE_URL` — the post-deploy smoke test |
| `npm run db:migrate` | apply to a real database (needs `DATABASE_URL`) |

Verification runs against **PGlite** — Postgres 18.3 compiled to WASM, in-process, with the real `citext` extension and Drizzle's real migrator. So "migrations run clean" is checked on every machine with no server and no cloud account, and the same harness will carry Phase 6's authorization tests.

**46 assertions pass**, offline and against Neon: migrations apply and re-apply idempotently, all 13 tables exist and nothing extra, the 16 capabilities and 5 roles come back by query, every role's bundle matches, `citext` makes email case-insensitively unique, every check constraint rejects bad input, and deleting a band cascades songs/memberships/grants/user state while `audit_log` survives with `band_id` nulled.

The same script runs either backend: `--url` swaps PGlite for `postgres.js` and points at a real database, so "is this instance actually migrated and seeded" is checkable, which applying migrations alone does not prove. Every mutating assertion runs in a transaction that is always rolled back, and `rejects()` uses savepoints so an expected error doesn't poison the run — pointing it at a database leaves no rows behind, and a final check proves it. The cascade assertions read *global* row counts, so they skip themselves with a notice if the tenant tables aren't empty.

### Where it runs

**Neon free tier**, project `practice-portal`, region **`us-east-2`** (Ohio). $0/month, no card, scale-to-zero after 5 minutes idle — which is what makes it pair with an auto-stopping Fly machine rather than fighting it.

| Free-plan limit | Headroom at our scale |
|---|---|
| 0.5 GB storage per project | A fully tapped song config is ~30 KB (half of it `tapMap`), and media stays in R2. 500 songs ≈ 15 MB, ~3% of the cap. |
| 100 CU-hours/month | Only burned while a query is in flight; idle costs nothing. |
| 100 projects | Production and staging are both free (Phase 11 wants a staging environment). |

Two decisions that constrain later phases:

- **Use the direct connection string, not the pooled one.** Neon's pooled endpoint is PgBouncer in transaction mode, and `postgres.js` issues prepared statements by default — that combination produces alternating `prepared statement "s1" already exists` / `does not exist` errors under load, and would force `prepare: false` in `server/db/client.ts`. We run one long-lived server with its own pool (`max: 10`), which is the case direct connections are for. If Phase 4 ever moves reads to an edge runtime, swap to `@neondatabase/serverless` at that same boundary instead.
- **Region `us-east-2` pins the Fly region.** Phase 3 should deploy to `ord` (Chicago) or `iad` (Ashburn) so the API isn't a continent away from its database. Changing a Neon project's region means recreating the project.

The failure mode to watch: exceeding a monthly free limit **suspends compute until the next billing month** rather than billing you. Good for a hobby budget, bad for uptime — Phase 11's uptime checks should cover it.

### Divergences from the SQL sketch above

Each of these is a deliberate change, not a transcription slip:

1. **`org` table now exists.** `band.org_id references org(id)` pointed at a table the sketch never defined, which is a hard error. It's three columns and stays empty — the hedge is unchanged.
2. **`membership.role` and `invite.role` are foreign keys to a `role` table, not check constraints.** The sketch's `check (role in ('manager','editor','member'))` directly contradicts "splitting Editor into Editor + Producer later must be a row change, never a code change" — a new role would have needed an `ALTER`. Now it's an insert.
3. **`role.membership_eligible`** marks `owner` and `guest` as not assignable via membership (Owner lives in `band.owner_user_id`; Guest is a grant-link actor kind). Postgres can't express that as a cross-table check, so the roster/invite code enforces it.
4. **`song.media_prefix`.** Phase 4 says media doesn't move and rows store R2 keys — but nothing in the sketch could hold `dev/songs/8xDKlqH`. Without it there's no way back from a row to its audio, and a slug rename would strand the objects.
5. **`audit_log.actor_kind` got a real check** for `user | grant | system | support`; the sketch listed them in a comment only.
6. **Added** `setlist.created_at` and indexes on `band(owner_user_id)`, `membership(band_id)`, `invite(band_id)`, `grant_link(band_id)`, `audit_log(band_id, at desc)`.

### Two things to confirm

- **Role bundles are derived, not authoritative.** `practice-portal-roles.pdf` wasn't available, so the bundles come from constraints stated in this plan: Owner alone gets `band.publish`/`transfer`/`billing`/`delete`; Editor is denied `song.delete` and `song.timing.write` (Phase 6's exit criteria); Member gets read + download. Worth diffing against the PDF — but by design it's an `INSERT`/`DELETE` on `role_capability`, no migration and no deploy.
- **`song.slug` is `NOT NULL` and unique per band**, while today's `discography.json` has songs with no slug (`song-title-dev`, `dev-dev`). Phase 4 has to generate slugs on import and handle collisions.

---

## Phase 3 — The server and its container

- [x] Scaffold the API server mounting the Phase 1 core handlers. **Plain `node:http`, not Hono or Fastify** — see *What landed — the server*.
- [x] Write the `Dockerfile`: Node 22 base, then `ffmpeg` and **MuseScore** installed in the image. MuseScore needs Qt and a virtual display — `xvfb-run` confirmed mandatory. Four distinct failures to get through; see below.
- [x] Verify in-container: `ffmpeg -version`, and an actual `.mscz` → `.mxl` conversion of a real file from the repo. **Green on both arm64 and amd64.**
- [x] Add a `/healthz` endpoint and a smoke-test script.
- [x] Deploy to Fly.io — live at `https://practice-portal.fly.dev` since 2026-10-27, one `shared-cpu-1x`/512 MB machine in `ord` (`fly deploy --ha=false`), `smoke:server --url` 16/16 against it. Read-only mode needs no secrets and no volume; R2 credentials, `DATABASE_URL` and a scratch volume come with writes.
- [x] Build the image locally once (`docker build --build-arg VITE_R2_PUBLIC_URL=...`). arm64, 2026-10-27: `smoke:server --url` 15/15 against the container, `mscz-smoke` 0 failures, 2.42 GB. amd64 still unbuilt — `fly deploy` builds it remotely.
- [ ] ~~Keep the API on a subdomain (`api.<domain>`) with the SPA still on Cloudflare Pages.~~ Superseded for now: the server serves the SPA itself. Revisit when sessions need a cookie domain (Phase 5).

**Exit criteria**: deployed container converts a real `.mscz` and transcodes a real stem, driven by curl. Still no auth — not yet public-facing.


### Custom domain — practiceportal.app (2026-10-28)

- **`https://practiceportal.app` is production.** Registered with Cloudflare; DNS in the same account as R2. `A`/`AAAA` for `@` and `www` point at the app's Fly addresses (`66.241.124.147`, `2a09:8280:1::1d1:2292:0`), **DNS only** — an orange-cloud proxy would stop Fly issuing its Let's Encrypt certificates (`fly certs add` for both names).
- **One address.** `CANONICAL_HOST=practiceportal.app` (fly.toml) sends `practice-portal.fly.dev` and `www.practiceportal.app` a 308 to it, path and query kept. Sessions are per hostname, so one address means one sign-in. `/healthz`, Fly's internal names and bare IPs are never redirected. Unset, nothing redirects — which is how the code shipped before the domain resolved.
- **Google sign-in** has `https://practiceportal.app/api/auth/google/callback` as a redirect URI and `practiceportal.app` as an authorized domain. **R2 CORS** allows the new origin for score uploads.
- **GitHub Pages stays** as a read-only fallback reading R2.
- A new `.app` registration took a while to appear at the registry (NXDOMAIN at the `.app` nameservers, then NOERROR with no records, then resolving). While checking, the local resolver kept serving stale answers and direct queries to Cloudflare's nameservers came back REFUSED — DNS-over-HTTPS (`cloudflare-dns.com/dns-query`, `dns.google/resolve`) gave the true picture.

### What landed — the server

**The site runs on a server, unchanged, and the server is read-only.** Decided 2026-10-27: host first, accounts after. Phase 5 needs a deployed server to build against anyway (cookies, magic-link emails), and Phase 5 also depends on Phase 4 — so "accounts first" would have meant Phases 4 and 5 with nothing hosted.

```
server/main.ts                 entrypoint: /healthz, /api/* (all refused), SPA
server/adapters/nodeApi.ts     Node req/res ↔ core, shared with the Vite plugin
server/adapters/staticFiles.ts dist/ with SPA fallback, gzip, ETag, immutable assets/
scripts/server-smoke.ts        npm run smoke:server [-- --url https://...]
fly.toml                       ord, auto-stop, /healthz check, no secrets
```

Why read-only is free: **the public site never calls `/api`.** Registry, band, song config, lyrics, notes, setlists and media are all fetched straight from the R2 public URL; every `/api` call comes from an admin control, and the admin UI isn't in the production bundle. So the server refuses every `/api` route with a 403 *before reading the body*, needs no R2 credentials or `DATABASE_URL`, and admin keeps working exactly as before via `npm run dev`. Reads are refused too: the one GET route, band storage, runs a full R2 listing — unauthenticated, that leaks bucket layout and lets anyone run up R2 operations once credentials are set.

That gate (`server/main.ts`) is the only thing between the internet and an unauthenticated write API. **Do not loosen it before Phase 6**; the smoke test asserts it on every run.

Decisions worth knowing:

- **`node:http`, not Hono.** The core already has its own router (`server/core/router.ts`), and `nodeRequest.ts` already speaks `IncomingMessage`. A framework would have been a second router in front of the first. Revisit if middleware piles up in Phase 5.
- **The Vite plugin shrank again.** Its request → core → response logic moved to `server/adapters/nodeApi.ts`, so dev and production run the same adapter; the plugin is now ~25 lines.
- **Bundled with esbuild, `--packages=external`.** `dist-server/server.js` is ~37 KB; `node_modules` stays in the image, production dependencies only (`npm ci --omit=dev --omit=optional`). Everything the bundle imports at runtime — `drizzle-orm`, `postgres`, `zod`, `busboy`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` — must therefore live in `dependencies`; a misfiled one fails at boot with `ERR_MODULE_NOT_FOUND`. `mscz-smoke.ts` is bundled the same way (`npm run build:smoke` → `dist-server/mscz-smoke.js`), so the image needs neither `tsx` nor TypeScript sources.
- **The image is now three stages.** The new `web` stage runs `npm run build && npm run build:server` on `$BUILDPLATFORM`. `VITE_R2_PUBLIC_URL` is a **build arg**, baked into the bundle — it's public, and `.env` is dockerignored.
- **The SPA is served from the same origin**, rather than Pages + `api.` subdomain. One deploy, no CORS. Cloudflare can still sit in front for caching.

Verified locally: `npm run build`, then `npm run smoke:server`, 16/16 — healthz, SPA root, deep-link fallback, immutable hashed assets, missing asset → 404 (not `index.html`), path traversal refused, storage read and five write routes → 403, unknown `/api` → 404.

Security pass (2026-10-27): no `.env`, `.git` or credential values anywhere in the image or its history; the bundle carries only `VITE_R2_PUBLIC_URL`. Encoded `../`, null bytes, `/.env` and absolute-form request targets all fall back to `index.html` or 404 — nothing from the filesystem. The container runs as an unprivileged `app` user (uid 10001) with `/app` read-only to it. Also checked gzip, ETag → 304, and that the Vite dev server still routes the API.

### What landed — the container

**14/14 pass on `linux/arm64` and `linux/amd64`**, plus 14/14 natively on macOS. Headless `.mscz` → `.mxl` works: 0.4s native arm64, 1.5s amd64 under emulation (real Fly hardware will be faster). Measure, note and part counts match the macOS-produced `Wiggle.mxl` on every platform.

This was the load-bearing assumption of the whole plan — *Host: Node in Docker on Fly.io*, with "Workers-only would force dropping server-side `.mscz`" as the consequence if wrong. It holds.

```
Dockerfile              node:22-bookworm-slim + ffmpeg + MuseScore 4.7.5
.dockerignore
scripts/mscz-smoke.ts   exercises the real code paths, not `mscore` directly
```

Two facts drove the image, both worth not rediscovering later:

- **MuseScore ships as an AppImage, and AppImages want FUSE**, which containers don't have. So it's extracted at build time (`--appimage-extract`) and `AppRun` is invoked directly.
- **MuseScore 4 dropped `-platform offscreen`.** It worked in MuseScore 3; in 4 the CLI needs a real X display even to convert a file. Every invocation goes through `xvfb-run`. This is the single most likely thing to break, and there's no way around it short of dropping server-side `.mscz`.

MuseScore publishes **both x86_64 and aarch64 AppImages**, so the image builds natively on an Apple Silicon laptop *and* on Fly's amd64 machines — the spike doesn't have to run under emulation. The arch is selected from `TARGETARCH`.

`scripts/mscz-smoke.ts` calls `resolveMscoreBin()` and `convertScore()` rather than shelling out, because the question isn't "does MuseScore run" but "does *our* code work in this image" — including the `-v` probe, which must exit 0, and the tolerate-crash-on-exit logic from commit `3ad3c65`. It also runs a synthetic stem through `ffprobe` → `measureLoudness` → `transcodeToOpus`, so no audio needs committing.

**Baseline: 14/14 pass on macOS** (MuseScore 4 local install, conversion in 0.7s). The `.mxl` comparison is structural — measure, note and part counts against the committed `Wiggle.mxl` — because MXL is a zip and zips embed timestamps, so byte-for-byte would fail for uninteresting reasons.

### Four failures, in the order they appeared

Each of these is cheap once you know it and expensive when you don't.

| Symptom | Cause | Fix |
|---|---|---|
| `npm ci` → `sh: 1: git: not found`, exit 127 | `package.json`'s `prepare` script is `git config core.hooksPath .hooks` | `npm pkg delete scripts.prepare` before `npm ci` — narrower than installing git, and leaves every other lifecycle script running |
| A wall of ``version `GLIBC_2.38' not found`` | MuseScore 4.7.5 needs glibc 2.38 / GLIBCXX 3.4.32; **bookworm ships 2.36** | Base image → `node:22-trixie-slim` (glibc 2.41) |
| `xvfb-run: error: xauth command not found`, exit 3 | `xvfb-run` shells out to `xauth` | Install `xauth` alongside `xvfb` |
| `error while loading shared libraries: libgpg-error.so.0` | The AppImage bundles `libgcrypt` but not its `libgpg-error` dependency | Install `libgpg-error0` |

Debian 13 renamed two packages in the time64 transition: `libglib2.0-0` → `libglib2.0-0t64` and `libasound2` → `libasound2t64`. Everything else in the Qt list kept its name.

Two more worth knowing:

- **Qt warns the `C` locale isn't UTF-8** and silently switches to `C.UTF-8`. Score titles and part names carry accented characters, so `LANG=C.UTF-8` is set explicitly rather than left to that fallback.
- **`ldd` across the whole bundle finds every missing library in one pass**, instead of rebuilding once per error:
  ```bash
  LD_LIBRARY_PATH=/opt/musescore/lib sh -c '{ ldd /opt/musescore/bin/mscore4portable; for f in /opt/musescore/lib/*.so*; do ldd "$f"; done; } 2>/dev/null | grep "not found" | awk "{print \$1}" | sort -u'
  ```
  It reported exactly two: `libgpg-error.so.0` (fatal) and `libpipewire-0.3.so.0` (has an AppRun fallback).

### Why MuseScore gets its own stage

The amd64 build failed where arm64 succeeded: `Exec format error`, exit 126. `--appimage-extract` means *executing* the AppImage's runtime, which is **static-pie** linked — and QEMU user-mode emulation cannot exec static-pie binaries. Ordinary dynamically-linked amd64 binaries (`apt`, `curl`) emulate fine; this one can't. So a cross-arch build cannot self-extract.

A type-2 AppImage is just a squashfs archive appended to an ELF runtime, so stage 1 computes where the ELF ends (`readelf -h`, then `shoff + shentsize × shnum`) and `unsquashfs`es from that offset — no execution at all. That stage runs on `$BUILDPLATFORM`, so it isn't emulated either, and `binutils`/`squashfs-tools` stay out of the runtime image.

**Do not find the offset by grepping for the `hsqs` magic bytes.** On the x86_64 AppImage the real payload starts at 944632, but `grep -abo hsqs` also matches at 194183 — a byte coincidence inside the runtime. The `readelf` arithmetic is authoritative; the `hsqs` check is an assertion on it, not a search for it.

To reproduce:

```bash
docker build --build-arg VITE_R2_PUBLIC_URL=... -t practice-portal .
docker run --rm -v "$PWD/docs/public/xml-sample:/fixtures:ro" \
  -e FIXTURES_DIR=/fixtures practice-portal node dist-server/mscz-smoke.js
```

Both arches build from the same Dockerfile; add `--platform linux/amd64` for the Fly target.

### Trimming the image

2.42 GB → 1.51 GB on arm64 (2026-10-27). Two cuts:

- **MuseScore, 569 MB → 299 MB.** Stage 1 deletes what headless conversion never touches: `appimageupdatetool.AppDir` (the self-updater, 132 MB), the soundfont (`share/mscore4portable-4.7/sound`, 49 MB), UI and Qt translations (`share/.../locale`, `translations`), the GUI's `qml` modules, and `share/.../{templates,autobotscripts,plugins,extensions,wallpapers}` plus `share/doc`. Checked empirically: `mscz-smoke` 0 failures, and the converted MusicXML is byte-identical (bar the encoding date) to the untrimmed build.
- **`node_modules`, 311 MB → 82 MB**, from production-only install (above).

**Do not delete the top-level `plugins/`.** Those aren't MuseScore plugins, they're Qt's — including `platforms/libqxcb.so`. Without it `mscore` can't attach to the Xvfb display, even `mscore -v` fails, and `resolveMscoreBin()` returns `null`. Deliberately kept, though not needed for the Wiggle fixture: `share/.../tables` (instrument and chord data, 13 MB) and `fallback` (AppRun's libjack/libnss3/libpipewire fallbacks).

The container's media toolchain is no longer a risk.

---

## Phase 4 — Migrate R2 JSON into Postgres

- [x] Write `scripts/import-r2-to-postgres.ts` with a `--dry-run` flag, following the pattern already established in `scripts/migrate-config-to-r2.ts`. Also `--pglite`, a full rehearsal against a throwaway in-process database.
- [x] Walk `bands.json` → each `band.json` → each song `config.json` → each setlist, validating every record against the existing Zod schemas on the way in. Schema violations should fail loudly rather than be coerced. Lyrics and notes too — the plan's walk missed them.
- [x] Media stays exactly where it is. Only JSON moves; store R2 object keys as references.
- [x] Verify: row counts match file counts, and a diff of `config` jsonb against the source JSON is empty for every song. Runs inside the import's own transaction, so a mismatch rolls the whole import back.
- [x] Serve reads from the API with ETag and cache headers. **Diverged:** `GET /api/data/<R2 key>` mirrors the R2 layout rather than `/api/bands/:slug/songs/:slug/config` — see below. `no-cache` + ETag, same as R2; Cloudflare in front is still open.
- [x] Keep Postgres in step while the admin still writes R2: every R2 JSON write, delete and copy is mirrored (dev, when `DATABASE_URL` is set).
- [x] Deploy with `DATABASE_URL` as a Fly secret; `check-data-parity --url https://practice-portal.fly.dev` shows 0 differences. Live 2026-10-27: 308 documents, 0 differences; smoke 23/23; `/api/data` answers in 0.15–0.3 s warm, on par with R2.
- [x] Dual-read period: keep the R2 JSON files in place, untouched, as a rollback path. They're still the admin's write target, so they stay current; rolling back is a rebuild without `VITE_DATA_SOURCE=api`.

**Exit criteria**: the SPA runs entirely off API reads, with R2 JSON still present but unread.

### What landed — the import

**Imported into Neon on 2026-10-27: 6 bands, 93 songs (40 with lyrics, 16 with band notes), 10 setlists.** Every record passed its Zod schema with nothing coerced, and every stored jsonb value equals its source file. Owner of all six: `brianburwell11@gmail.com`.

```
server/db/migrations/0003_import_columns.sql   band.legacy_id, band.position, setlist.position, song.lyrics, song.notes
scripts/import-r2-to-postgres.ts                --pglite | --dry-run | (commit); --owner <email> required
```

Order of operations that worked: `--pglite` rehearsal → `db:migrate` + `db:verify:remote` → `--dry-run` against Neon (then confirmed 0 rows) → real run → a second run refuses with `already imported`.

Decisions, each forced by something in the data or the UI:

- **Slugs come from what the URL already uses**, so no link changes. 4 songs had no slug; `SongList` already falls back to the song id for the URL hash, so that's the slug (`abba-mashup-dirty-chai`). 3 setlists had none; the URL uses the id minus `setlist-`, so that's the slug (`guitar-subs`). Collisions abort the run — there were none.
- **Band slug is the route verbatim**, dot and all (`zenzi.music`). It is not held to `[a-z0-9-]+`.
- **`band.legacy_id`** keeps the old id (`z17zqzxv`). Every R2 key for the band starts with it, and media doesn't move.
- **`position` on band and setlist.** The band picker and setlist menu show file order as-is; without a column, the DB would lose it. Songs need none — `SongList` sorts by title.
- **`song.lyrics` and `song.notes` jsonb.** The schema had nowhere to put them. Band notes only; personal notes stay `user_song_state`'s job.
- **Every band imported `public`.** The column defaults to `private`, but every band is publicly readable today; private is Phase 7's job.
- **The source JSON is stored, not Zod's output.** `songConfigSchema` defaults `beatOffset` and strips unknown keys; storing the parse result would have produced a diff.

**Postgres was a snapshot at import time.** Admin edits via `npm run dev` wrote only to R2 until the mirror below landed. Re-importing means deleting the imported bands first — the script refuses to overwrite by design.


### What landed — reads from Postgres

```
server/core/documents.ts        R2 key ↔ rows: readDocument, mirrorWrite, mirrorDelete
server/core/handlers/data.ts    GET /api/data/<key> — the one route marked public
src/utils/url.ts                dataUrl(): /api/data when VITE_DATA_SOURCE=api, else R2
scripts/check-data-parity.ts    every document, R2 vs API, --url <server>
scripts/verify-mirror.ts        admin flows replayed through the mirror, offline
```

**The API mirrors the R2 layout instead of the planned slug routes.** `/api/data/dirty-chai/songs/discography.json` returns what R2 returns at `dirty-chai/songs/discography.json`. The SPA's only change is the base URL of 20 JSON fetches — no new shapes, no new 404 handling — which is what "don't change the website" needed. Slug-addressed routes can come with Phase 5, when something other than the SPA consumes them.

**Item documents are stored; index documents are built.** A song's config, lyrics and notes, each setlist, and each band are jsonb in their row and come back verbatim. `registry.json`, `discography.json` and `setlists/index.json` are never stored — built on read. Checked before relying on it: across all 6 bands every registry, discography and setlist-index entry is a pure function of its item file, except one discography entry with a trailing space in the artist that its config doesn't have. Writes to an index carry only order, kept in `position`.

**Parity: 308 documents compared, 0 differences** against a local server on Neon — every band, discography, config, lyrics and notes file (including the 404s for songs that have none), setlist index and setlist.

**Dev writes mirror into Postgres.** `server/core/r2.ts` takes a `JsonMirror`; the Vite plugin registers it when `DATABASE_URL` is set. Handlers are untouched. Three things the replay test (`verify-mirror.ts`, 25 checks) caught or pinned down:

- **Renames collide on slug.** `renameSong` writes the new config *before* deleting the old one, and `SetlistModal` saves the new setlist id before deleting the old — R2 tolerates two holders of a slug for a moment, the unique constraint didn't. Last writer now takes the slug and the other row drops to one built from its own id. Reads build slugs from the documents, so the SPA sees no difference.
- **Copies mirror from the destination.** A rename deletes the old config (and with it the row) before copying lyrics and notes across, so a copy re-reads what R2 now holds at the target.
- **Mirror failures are logged as well as thrown.** Several handlers wrap R2 deletes in a bare `catch {}`; a swallowed mirror error would leave Postgres silently stale. If Neon is down mid-edit, R2 has the change and the admin sees an error — run `check-data-parity` to see the drift.

**Rollback** is a build flag: the Docker image sets `VITE_DATA_SOURCE=api`; without it the bundle reads R2 exactly as before (the default build contains no `/api/data` reference). GitHub Pages and `npm run dev` don't set it.

---

## Phase 5 — Accounts, memberships, invites

**Revised 2026-10-27: Google sign-in only, invite links you send yourself.** That drops magic links and with them any email-sending service. Decisions:

| Decision | Choice | Why |
|---|---|---|
| Sign-in | Google only | One button, no passwords, no email service. People without a Google account wait for a second method. |
| Sharing | Invite links, optionally locked to an email | You copy the link and text it. Locking it to an address stops a forwarded link being used by someone else. |
| Visibility | Per band: Public or Members-only, set by the Owner | Every existing band stays Public, so nothing changes for visitors until a band is flipped. Owner-only because the catalog gives `band.publish` to the Owner alone. |
| Scope | Accounts + sharing | Editing on the hosted site stays Phases 6 and 8. |

**Members-only is partial until Phase 7.** It hides the band in the app on Fly, but the band's JSON and media are still on the public R2 URL, and the GitHub Pages build reads R2 directly. The UI says so wherever the setting appears.

### 5a — Schema
- [x] `app_user`: `google_sub` (unique), `display_name` from Google, `avatar_url`.
- [x] `session`: token hash, user, created/expires/last-seen. Only the hash is stored.
- [x] `invite`: `revoked_at`, `accepted_by`. `email` (already there) is the optional lock. Plus `created_at`.
- [x] Migration 0004; `verify-db` covers the new tables and constraints. Applied to Neon.

### 5b — Google sign-in
- [x] Google OAuth client (Brian, in Google Cloud Console): redirect URIs `https://practice-portal.fly.dev/api/auth/google/callback` and `https://localhost:5173/api/auth/google/callback`.
- [x] `/api/auth/google/start` → Google with state, nonce and PKCE (S256), held in a short-lived httpOnly cookie.
- [x] `/api/auth/google/callback` → exchange the code, require `email_verified`, upsert the user by `google_sub`. An existing user with the same verified email (the imported owner) is linked, not duplicated.
- [x] Session cookie `pp_session`: httpOnly, Secure, SameSite=Lax, 30-day absolute expiry, new token on every sign-in. Non-GET requests carrying it must come from our own Origin.
- [x] `POST /api/auth/logout`, `GET /api/me` (user plus their bands and roles).
- [x] The core learns about the caller: `CoreRequest.actor`, resolved from the cookie by the adapter.


#### Setting up Google sign-in

About five minutes in the [Google Cloud Console](https://console.cloud.google.com/). Nothing here costs money.

1. **Create a project**, or reuse one, e.g. "Practice Portal". Use the project picker at the top of the console.
2. **Set up the consent screen.** Open **Google Auth Platform** (older consoles call it **APIs & Services → OAuth consent screen**).
   - **Audience:** External.
   - **App name** and **support email:** anything sensible. Band members see the name on Google's account chooser.
   - **Scopes:** only the defaults — `openid`, `email`, `profile`. Adding anything else triggers Google's review.
   - **Publish the app** once it's set up. Left in *Testing*, only accounts you list as test users can sign in. These basic scopes publish without review.
3. **Create the client.** Go to **Clients** (or **APIs & Services → Credentials**) → **Create OAuth client**.
   - **Application type:** Web application.
   - **Authorized redirect URIs** — exactly these two, no trailing slash:
     - `https://practice-portal.fly.dev/api/auth/google/callback`
     - `https://localhost:5173/api/auth/google/callback`
   - Leave **Authorized JavaScript origins** empty; the flow is server-side.
4. **Copy the Client ID and Client secret into `.env`** (it's gitignored):
   ```
   GOOGLE_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   ```
5. **Try it locally:** `VITE_DATA_SOURCE=api npm run dev`, open `https://localhost:5173`, and sign in from the button in the band header. The flag makes local reads go through `/api/data`, so Members-only bands behave as they will on Fly.
6. **Give Fly the same two values**, read from `.env` so they never appear on screen, then deploy:
   ```
   grep -E '^GOOGLE_CLIENT_(ID|SECRET)=' .env | fly secrets import --stage -a practice-portal
   fly deploy --ha=false
   ```

If sign-in fails with `redirect_uri_mismatch`, the URI in step 3 doesn't match what the browser used — check the scheme (`https`), host, port, and that there's no trailing slash. A custom domain later needs its own redirect URI added here.

### 5c — Invites
- [x] Owner and Manager create an invite: role, optional email lock, single use, 7-day expiry. Only the token hash is stored.
- [x] List and revoke pending invites.
- [x] `/invite/<token>` page: sign in with Google, then join. A locked invite rejects a different Google account and says which address it expects.
- [x] Rate-limit invite creation. 20 per user per hour, in memory.

### 5d — Roster
- [x] List members with role and join date; change roles; remove members.
- [x] Multiple Managers allowed. Nobody can remove or demote the Owner. Nobody grants or changes a role above their own.
- [x] Ownership transfer, Owner only, to an existing member. The old Owner stays on as a Manager.
- [x] These checks run through `can(actor, capability, band)` against the role tables, the first slice of Phase 6. Every change writes an `audit_log` row in the same transaction.

### 5e — Members-only bands
- [x] Visibility toggle for the Owner, with the R2 caveat beside it.
- [x] `/api/data` serves a members-only band only to its members; the registry lists it only for them.
- [x] Signed-out visitors to a members-only band get a "sign in to view" page instead of "not found".

### 5f — UI
- [x] Sign-in button and account menu, in the production bundle. Hidden where `/api/me` says sign-in isn't configured, and on static hosts.
- [x] Members panel (roster and invites) for Owner and Manager.

### 5g — Ship
- [x] Fly secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; deploy. Live 2026-10-27: sign-in enabled with the right `redirect_uri`; smoke 27/27; `verify-members --url` 41/41 against Fly; parity 270/0 with the two Members-only bands skipped. Local dev and Fly share the Neon database, so visibility set while testing locally is live too.

**Exit criteria**: a second real person opens an invite link, signs in with Google, appears in the roster with the right role, and can see a members-only band that a signed-out visitor can't.

**Tests:** `verify-auth.ts` (24 offline: claims, PKCE, state, open redirects); `verify-members.ts --url` (41 against a server and Neon, with throwaway users and band, all cleaned up); `server-smoke.ts` 27; parity still 308/0. The UI is built but not yet driven in a browser — that needs the Google client.

---

## Phase 6 — Authorization on every write

**Revised 2026-10-27: done together with Phase 8**, as one round with one goal — *Managers and Editors edit songs from the live site, safely*. Phase 6 alone changes nothing visible; Phase 8 alone would be unsafe. Decisions:

| Decision | Choice | Why |
|---|---|---|
| Source of truth | **Postgres first.** Each request's writes and its audit row commit in one transaction; R2 JSON gets a copy after commit. | "Audit in the same transaction" needs it, and a failed mirror can no longer leave the two out of step. The R2 copy keeps GitHub Pages and rollback working. |
| Dev | **Same rules as live.** `npm run dev` requires sign-in and enforces roles. | Closes the hole where anyone on the Wi-Fi could edit while dev ran (`host: true`). |
| MuseScore | **Trim it.** Keep `.mscz` uploads; delete the ~260 MB conversion never touches (AppImage updater 132 MB, soundfont 49 MB, translations 54 MB, templates/plugins/test scripts ~25 MB) and prune dev-only `node_modules`. | MuseScore has no standalone converter — `mscore -o` is the whole app, headless. A separate converter machine stays an option for Phase 9. |
| New bands | **Platform admins only** (`ADMIN_EMAILS`) until quotas and billing exist. | Creating a band means storage someone pays for. |

### 6a — Every route declares who may call it
- [x] `RouteDef.access`: `public`, `signedIn`, `platformAdmin`, or a capability. Enforced in the core router, so dev and Fly share one check. No declaration → refused. Authorization runs before any precheck or upload is read.
- [x] Song config saves resolve their capability from what changed: timing (`tapMap`, `tempoMap`, `timeSignatureMap`, `markers`, offsets) → `song.timing.write`; stems → `song.audio.write`; score → `song.score.write`; the rest → `song.content.write`. A new song needs only `song.create`.
- [x] A test enumerates the route table and fails on any route without a declaration. `verify-access.ts`: also unknown capabilities, capability routes with no band in the path, public writes, and write routes that don't declare what they write.
- [x] The band comes from the path, and the capability is checked against that same band — nothing a handler touches is outside it.

### 6b — Postgres first
- [x] A request-scoped transaction: every JSON document a handler reads comes from Postgres, every write goes to Postgres, and R2 copies are queued until commit. `store.ts`, on AsyncLocalStorage. Media: copy before commit, delete after.
- [x] One `audit_log` row per write request, in that transaction: route, band, actor, target. Media routes are audited after success instead — a transcode shouldn't hold a transaction open for minutes.
- [x] Handlers move off `r2ReadJson`/`r2WriteJson` for JSON documents; media stays on R2 as-is.
- [x] `registry/rebuild` retires — the registry is built from rows on read.

### 6c — Dev requires sign-in
- [x] The Vite plugin enforces the same access rules; without `DATABASE_URL` it refuses writes rather than running open. The dev write mirror is gone with it.

### 6d — Prove it
- [x] An Editor is refused deleting a song and editing timing; a signed-out request changes nothing; a member of one band can't write to another. `verify-writes.ts --url`: 36 checks through a server, Postgres and R2, cleaned up after.
- [x] Parity stays 0 against R2 copies written after commit.

### The original Phase 6 list

Kept for reference; 6a–6d above are how each item gets done. `can()` already exists from Phase 5.

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

- [x] Replace every `import.meta.env.DEV` gate with capability checks driven by the session. Affected: `src/main.tsx`, `src/App.tsx`, `src/admin/AdminRibbon.tsx`, `src/components/band/BandPicker.tsx`, `src/components/mixer/MixerPanel.tsx`, `src/components/notes/NotesLayer.tsx`, `src/hooks/useNotesKeyboard.ts`.
- [x] Keep admin routes lazy-loaded, so Members don't download the wizard bundle.
- [x] Treat client-side gating as UX only — the server is the enforcement boundary.
- [x] Empty and unauthorized states: what a Member sees where an Editor sees a control.

### 8a — The session knows what you can do
- [x] `/api/me` returns each band's capabilities, read from the role tables, so the UI gates on the same data the server enforces. Plus `platformAdmin`.

### 8b — Gates
- [x] Each `import.meta.env.DEV` gate above becomes a capability check: Songs menu items by `song.create` / `song.content.write` / `song.timing.write` / `song.delete`; Setlists by `setlist.write`; Edit Band by `band.settings`; Delete Band by `band.delete`; New Band by platform admin; mixer save and band notes by their capabilities. None remain in `src/`. Admin pages sit behind `RequireCan` and stay code-split.
- [x] Controls you can't use are hidden, not shown disabled — a Member's screen looks like today's public site.

### 8c — Uploads in production
- [ ] Fly secrets: R2 write credentials.
- [ ] R2 CORS allows `https://practice-portal.fly.dev` for presigned `PUT` (score uploads go straight from the browser to R2).
- [ ] Machine size and timeouts that survive a multi-stem transcode; measure a real one.
- [x] The trimmed image: MuseScore without updater, soundfont, translations, templates, plugins; production-only `node_modules`. `mscz-smoke` and `smoke:server` still pass. 2.42 GB → 1.51 GB (arm64). Qt's own `plugins/platforms` must stay — without it even `mscore -v` fails.

**Two bugs the end-to-end tests caught on the way:** the Add Song wizard saves the config and then adds the discography entry without `overwrite`, which Postgres-first turned into a 409 — the discography is built from configs, so the song is already listed; only a *different* song under the same id conflicts now. And a song rename deleted the old config (and with it the row's lyrics) before copying them across; it now copies first and deletes last.

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

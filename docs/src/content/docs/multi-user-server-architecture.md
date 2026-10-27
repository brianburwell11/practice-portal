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
- **Bundled with esbuild, `--packages=external`.** `dist-server/server.js` is ~37 KB; `node_modules` stays in the image (it's there for `mscz-smoke.ts` anyway).
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
docker build -t practice-portal-api .
docker run --rm -v "$PWD/docs/public/xml-sample:/fixtures:ro" \
  -e FIXTURES_DIR=/fixtures practice-portal-api npx tsx scripts/mscz-smoke.ts
```

Both arches build from the same Dockerfile; add `--platform linux/amd64` for the Fly target.

The container's media toolchain is no longer a risk.

---

## Phase 4 — Migrate R2 JSON into Postgres

- [x] Write `scripts/import-r2-to-postgres.ts` with a `--dry-run` flag, following the pattern already established in `scripts/migrate-config-to-r2.ts`. Also `--pglite`, a full rehearsal against a throwaway in-process database.
- [x] Walk `bands.json` → each `band.json` → each song `config.json` → each setlist, validating every record against the existing Zod schemas on the way in. Schema violations should fail loudly rather than be coerced. Lyrics and notes too — the plan's walk missed them.
- [x] Media stays exactly where it is. Only JSON moves; store R2 object keys as references.
- [x] Verify: row counts match file counts, and a diff of `config` jsonb against the source JSON is empty for every song. Runs inside the import's own transaction, so a mismatch rolls the whole import back.
- [x] Serve reads from the API with ETag and cache headers. **Diverged:** `GET /api/data/<R2 key>` mirrors the R2 layout rather than `/api/bands/:slug/songs/:slug/config` — see below. `no-cache` + ETag, same as R2; Cloudflare in front is still open.
- [x] Keep Postgres in step while the admin still writes R2: every R2 JSON write, delete and copy is mirrored (dev, when `DATABASE_URL` is set).
- [ ] Deploy with `DATABASE_URL` as a Fly secret; `check-data-parity --url https://practice-portal.fly.dev` shows 0 differences.
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

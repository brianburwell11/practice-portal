---
title: "Noisy Neighbours: Fair Sharing Between Bands"
description: "A to-do for later: stop one band's big upload from making every other band wait, and stop heavy MuseScore conversions from taking the server down."
pubDate: "Nov 13 2026"
tags: ["server", "jobs", "performance", "todo", "plan"]
---

**Status: parked, revisit later.** Nothing here is urgent at today's size (about 6 invite-only bands). It's written down so the plan is ready when more bands start uploading.

## Where this came from

An interview-prep reel on the "noisy neighbour" problem: every customer shared one job queue and one database, one customer's million import jobs went first in, first out, and everyone else waited behind them. Adding workers only made it busier. The fixes it gave:

1. Rate limits and quotas per customer
2. A queue per customer, with workers taking turns
3. A bulkhead: heavy work on its own workers and database pool

Here, a "customer" is a **band**.

## How the app works today (Nov 13 2026)

- **One queue, oldest first.** Stem transcodes go in the Postgres `job` table. The worker in `server/core/jobs/worker.ts` takes the oldest `queued` job (`orderBy(schema.job.createdAt)`), whatever band it belongs to. That is the reel's setup.
- **One worker, one job at a time,** inside the web server. About 16 s per 4-minute stem (Phase 9e).
- **No per-band limit on waiting jobs.** `createStemUploads` in `server/core/handlers/stems.ts` allows 32 stems per call (`MAX_STEMS`), with no cap on how many a band has pending.
- **Shared database pool** of 10 connections (`server/db/client.ts`). The worker uses about one, so the database is not the bottleneck.
- **Rate limits are per IP**, in memory (`server/core/rateLimit.ts`).
- **MuseScore runs inside the request.** `.mscz` conversion (`msczConvertUpload` in `server/core/handlers/uploads.ts`) starts MuseScore under Xvfb with a 60 s timeout and no limit on how many run at once, on a 1 GB machine.

### Can one band hurt the others?

- **Queue: yes, in principle.** One band adding 10 songs × 30 stems queues about 300 jobs, roughly 80 minutes of work. Another band's single stem waits behind all of it, with the Add Song wizard open.
- **Database: no.** The work is CPU and ffmpeg, not queries.
- **Memory: the more likely real problem.** A few `.mscz` uploads at once each start MuseScore plus Xvfb and could run the machine out of memory, taking the site down for everyone.

## Plan

None of these phases needs a migration, a new service or a new machine, so they fit the Phase 9 decisions in [Multi-User Server Architecture](/docs/multi-user-server-architecture/) ("a worker inside the existing server, one job at a time").

### Phase 1: Bands take turns in the queue
- [ ] In `claim()` (`server/core/jobs/worker.ts`), serve the band served least recently first, then oldest job within that band. Sketch:
  ```sql
  SELECT j.id FROM job j WHERE j.status = 'queued'
  ORDER BY (SELECT max(r.started_at) FROM job r WHERE r.band_id = j.band_id) ASC NULLS FIRST,
           j.created_at
  LIMIT 1 FOR UPDATE OF j SKIP LOCKED
  ```
  `started_at` (migration 0013) and `job_band_idx` already exist. The table is cleared daily, so no new index.
- [ ] Check the query plan with `EXPLAIN` on a seeded scratch database.
- [ ] Update the worker's header comment and the Phase 9 "claims the oldest `queued` job" wording in the architecture doc.
- [ ] Test in `scripts/verify-jobs.ts`: band A queues N jobs, then band B queues 1. B's job runs second, not last. A single band still runs in order.

### Phase 2: Cap waiting jobs per band
- [ ] In `createStemUploads`, count the band's jobs that are `uploading`, `queued` or `running`. Over the cap, refuse with 429 and a plain message (no em dashes in the copy).
- [ ] Count and insert in one transaction, or accept the small race (fine on one machine).
- [ ] Check `ReviewStep` and Edit Song show the server's message as written.
- [ ] Test in `verify-jobs.ts`: band A over the cap gets 429, band B is unaffected.

### Phase 3: Limit MuseScore conversions
- [ ] Add a small semaphore (in `server/core/media/run.ts` or `musescore.ts`) allowing 1 or 2 MuseScore conversions at a time.
- [ ] Extra requests wait briefly; past the limit, return 503 with `Retry-After`.
- [ ] Measure peak memory with `measure-transcode.ts` plus a concurrent `.mscz` before deciding whether a running ffmpeg job should count against the limit.
- [ ] Test: 4 concurrent `.mscz` uploads against a local server. At most N MuseScore processes run at once, and `/healthz` stays up.

### Later, only if traffic grows
- [ ] A separate worker machine (`WORKER=off` on web machines) with its own small database pool. The full bulkhead. Trigger: transcodes measurably slowing requests, or more than a handful of bands uploading at once.
- [ ] Per-band storage quotas (already on the Phase 9 "Later" list).
- [ ] Rate limits per user or band instead of per IP, once signup is open.

## Decisions to make first

- [ ] Per-band cap value. 96 (three full songs) is a starting point.
- [ ] Whether platform admins skip the cap for bulk imports.
- [ ] Whether a running ffmpeg job counts against the MuseScore limit.

## Testing rules

- Server scripts run on a scratch Docker Postgres with R2 blanked or SeaweedFS, the existing `verify-jobs.ts` setup. **Never Neon**, which is shared with production.
- Run `npm run build` (tsc + vite) before pushing.

## Out of scope

Separate queues or tables per band, pg-boss or BullMQ, multiple worker processes, billing, and turning `.mscz` conversion into a background job (Phase 9d kept it a request).

---
title: "Offline Editing: Prepping Songs on a Plane"
description: "Pin songs and setlists to the device, edit lyrics, chords and timing with no network, create new songs, and sync it all when you land, asking only when someone else changed the same thing."
pubDate: "Nov 13 2026"
tags: ["offline", "sync", "service-worker", "plan"]
---

**Goal:** prep songs with no network (lyrics, chords, timing, new songs), and have everything sync on its own when you're back online. It asks you to decide only when someone else changed the same document while you were away.

## Where things stand (Nov 13 2026)

- **Playback already works offline**, behind `VITE_OFFLINE_CACHE=1`. The service worker (`sw/sw.ts`) keeps versioned stems and scores as they're played, up to 500 MB, dropping the least recently played song first. `/api/data` documents are fetched from the network first; offline it serves the cached copy marked `X-Offline-Cache: 1`. The flag isn't set in any env file or the Dockerfile, so production doesn't have this yet.
- **Every write is a plain `fetch` POST**, so offline it just fails. Nothing queues, nothing retries.
- **No conflict detection.** Song config, lyrics, chords and setlists are whole-document overwrites (`saveSongConfig`, `saveSongLyrics`, `saveSongChords`, `saveSetlist`). Two editors already overwrite each other without knowing, online. `song.updated_at` exists but is shared by every document on the row and never reaches the client.
- **Notes** are the only writes that lock the song row (`lockSong`), and they merge one note at a time.

## Decisions

| Question | Answer |
|---|---|
| How do songs get onto the device? | **Pin songs or setlists**, like Drive's "Make available offline". Pinned songs are downloaded whole and never evicted. |
| What can be edited offline? | **Lyrics, chords, timing** (tapMap and markers), and **new songs** (stems upload when you land). |
| Conflicts | Sync on its own. **Ask per document** only when the same thing changed on the server. |
| Device | **Laptop browser** (Chrome or Safari on a Mac). iOS storage limits are out of scope. |

## How it fits together

```
 editors (lyrics, chords, marker)            new-song wizard
        │ saveDoc / readDoc                        │ saveDraft
        ▼                                          ▼
  src/offline/docs.ts ── IndexedDB "pp-edits"
        │                 docs:   { key, data, base, baseRev, dirty }
        │                 drafts: { wizard state + stem Files }
        │ sync engine (online event, app start, every 30 s while dirty)
        ▼
  server: a revision per document; If-Match → 409 { current, rev }
```

Each phase ships on its own. Phase 1 is worth having even if nothing else lands, because it stops editors overwriting each other online.

## Phase 1: Revisions and conflict detection

The server learns which version of a document an edit was based on, and refuses an edit made to an out-of-date copy.

- [x] `song` gets `config_rev`, `lyrics_rev`, `chords_rev` (integer, default 1); `setlist` gets `rev`. Migration via `npm run db:generate`.
- [x] `mirrorWrite` (`server/core/documents.ts`) bumps the matching rev on every write of that document.
- [x] `/api/data` reads (`server/core/handlers/data.ts`) send the document's rev in an `X-Doc-Rev` header.
- [x] `saveSongConfig`, `saveSongLyrics`, `saveSongChords`, `saveSetlist` accept an optional base revision. (Built as a `?baseRev=<rev>` query parameter rather than an `If-Match` header: handlers don't see request headers, and the query does the same job.) Inside the request transaction: lock the row, compare, and on a mismatch return **409 `{ current, rev }`**. No header keeps today's behaviour.
- [x] Write responses return the new rev.
- [x] Online editors send the rev they loaded (`fetchDoc` / `saveDoc` in `src/utils/docRevs.ts`): lyrics, chords, marker editor, mixer Save, Edit Song, stem alignment, YouTube offsets, setlists.
- [x] A 409 online shows "Someone else saved a change since you opened this. Reload to see the latest, then make your change again." The conflict dialog replaces it in Phase 3.
- [x] Tests: unit tests for the client side (`src/utils/docRevs.test.ts`). The read ETag includes the revision, so a 304 never hands back an old one. A lyrics or chords file that doesn't exist yet is revision 0.
- [ ] Test (script written, not yet run): `scripts/verify-revisions.ts` on scratch Docker Postgres with R2 blanked (never Neon). Two clients load lyrics, both save, and the second gets 409 with the first's text.

## Phase 2: Pin songs and setlists

- [x] Build production with `VITE_OFFLINE_CACHE=1` (set in the Dockerfile). The server's `OFFLINE_CACHE_DISABLED` kill switch still works.
- [x] `pins` store in `sw/store.ts` (IndexedDB version 2): `{ band, song }`, plus setlist pins that expand to their songs.
- [x] `planEviction` / `enforceCap` (`sw/eviction.ts`, `sw/store.ts`) never drop a pinned song. Pinned bytes are counted separately from the played-songs cap (500 MB by default, set per device in Offline songs).
- [x] `src/offline/pin.ts` downloader: `config.json`, `lyrics.json`, `chords.json`, `notes.json`, then every stem and score at the exact versioned URL the player asks for (`AudioEngine.ts`, `scoreFiles.ts`, both from `mediaVersions`), plus `band.json`, the discography and the setlist index.
- [x] ~~Media fetched for a pin is stored even when the 30-day check is stale.~~ Not needed: loading the band list online renews the check before any pin downloads. Pinned songs still stop playing after 30 days without reaching the server, like other offline songs.
- [x] Pinned songs refresh on app start when online, so they're current before you leave.
- [x] `navigator.storage.persist()` on the first pin, so the browser keeps the data.
- [x] UI: an "Available offline" toggle (`src/offline/OfflineToggle.tsx`) beside the song picker for the open song (the song picker is a dropdown, with no rows to hold one) and in the setlist page's header, with download progress and a check once complete. The Account menu (`OfflineSongs.tsx`) lists what's kept offline, with Remove for each, and the space it takes.
- [x] Tests: `sw/eviction.test.ts` covers pinned songs.
- [x] The app's own files: the build writes `offline-assets.json` (`vite-plugin-offline-assets.ts`), and pinning fetches them all (about 23 MB), so editors never opened before still load offline.
- [x] Wifi that's "connected" but reaches nothing (planes, hotels), or a server that can't reach its database, doesn't fail; it hangs. The worker (`sw/sw.ts` `networkFirst`) answers from the cache after 6 s without a reply, or on a 5xx, and for the next 20 s skips the wait. Found testing with wifi off against a local server: `registry.json` took 42 s, then a 500.
- [ ] Test: pin a setlist, turn wifi off (not just DevTools Offline), reload. Every song opens, every stem plays, scores render.

## Phase 3: Local edits and sync

- [x] `src/offline/connectivity.ts`: online state from `navigator.onLine`, `online`/`offline` events, failed fetches and `X-Offline-Cache` responses, plus a check every 30 s while offline.
- [x] Status indicator in the header (`SyncStatus.tsx`): "Offline", "3 changes waiting", "Syncing...", "1 needs a decision", "Sign in to sync".
- [x] `saveEdit` (`src/offline/sync.ts`): writes `{ data, base, baseRev }` to IndexedDB ("pp-edits", `editStore.ts`) first, then sends with `?baseRev=`. Success drops it and records the new revision; a network failure (or no answer in 15 s) leaves it waiting. One waiting copy per document, so repeated saves coalesce and keep the original base.
- [x] `readDoc`: your waiting copy if there is one, otherwise the network (recording `X-Doc-Rev` and the document as the base), otherwise the cached copy. An offline copy never replaces a revision the tab already knows.
- [x] Sync loop: on `online`, at app start, and every 30 s while anything is waiting. One run at a time, across tabs (`navigator.locks`).
  - 200: done.
  - 401: pauses, with "Sign in to sync".
  - 403 (or another refusal): drops the change, with a message.
  - 409: three-way merge.
- [x] Merge for **config** (`merge.ts`): top-level keys. Mine changed versus base, theirs changed versus base; if they don't overlap, merge and resend with no prompt. If the server already has the result (a save that went through but never answered), it's done.
- [x] Merge for **lyrics and chords**: resend only if theirs still equals the base; otherwise it's a conflict.
- [x] Conflict dialog, one per document: "Keep mine", "Keep theirs", "Decide later", and a side-by-side view for lyrics. Config conflicts name the parts you both changed. "Keep mine" resends based on the server's revision. Rendered at the page's top level (the header's transform otherwise traps it under the waveform).
- [x] The lyrics, chords and marker editors save through `saveEdit`; "Saved on this device. It syncs when you're back online." when it waits. Opening a song (`SongList.tsx`) and the editors (`App.tsx`) read through `readDoc`. A merge or "Keep theirs" updates the open song (`useSyncedDocs.ts`).
- [x] Everything else (notes, mixer Save, mixer templates, Edit Song, stem alignment, YouTube offsets, setlists, deleting) says "Available when you're back online" instead of failing or hanging (`onlineOrSay` / `onlineFetch`).
- [x] Edit buttons stay visible offline: the session comes from the cached `/api/me`.
- [x] A session the server can't check (database unreachable) is a 503, not "signed out" (`server/adapters/nodeApi.ts`). Before, the server answered anonymously with a 200, so the app showed you signed out and the offline cache kept that copy. Same for guest links. Requests without a session or guest cookie are unchanged.
- [x] Signing out with changes waiting asks first, then discards them (a shared device).
- [x] Waiting edits belong to the account that made them (shared devices). Only that account sees or sends them (`editStore.ts` keys them per account), and each send carries `?asUser=`: the server refuses it under any other session, before checking that session's permissions (`server/core/router.ts`, 403 `wrong-user`), so it's held, never applied as someone else's or dropped. Another account's edits show as "1 change waiting for Alex", with Discard behind a confirmation. Tested end to end: Alice's offline edit wasn't sent or shown while Bob was signed in, synced as hers when she signed back in, and Bob's discard never reached the server.
- [x] Tests: `merge.test.ts` (config merge, lyrics and chords conflicts, a save that already landed), `editStore.test.ts` (coalescing).
- [x] Tested end to end in headless Chrome against a stand-in API (signed-in admin, real revision rules, switchable "down"): lyrics saved offline survive a reload and sync when back; both sides changed lyrics shows the dialog side by side, and Keep mine and Keep theirs both work; timing changed offline plus a mix change elsewhere merges with no prompt.
- [ ] Test (Brian): wifi off, edit lyrics and the tapMap on a pinned song, reload (edits still there). Change the mix from another browser, wifi on: syncs with no prompt.
- [ ] Test (Brian): edit the same lyrics in both browsers: the conflict dialog appears, and both choices work.

## Phase 4: New songs offline

- [ ] Offline, the wizard's Review step offers "Save to upload later". The wizard state, stem `File`s included, goes into the IndexedDB `drafts` store.
- [ ] Timing works in the wizard offline: it decodes audio locally, and its marker editor hands the tapMap back without a fetch.
- [ ] A "Waiting to upload" list on the song list.
- [ ] Back online, the existing pipeline runs from the draft (`uploadStems`, `waitForStems`, `saveRest` in `ReviewStep.tsx` / `stemJobs.ts`), with progress, then the draft is deleted. The band's default mixer template applies as it does now.
- [ ] Test: offline, create a song with 3 stems and timing, close the tab, reopen online. It uploads, transcodes and appears in the list.
- [ ] Later, if wanted: open a draft in the player from local blob URLs, so lyrics and chords can be done before it uploads.

## Every phase

- [ ] `npm run build` (tsc + vite) before pushing.
- [ ] Commit once Brian confirms the tests pass.

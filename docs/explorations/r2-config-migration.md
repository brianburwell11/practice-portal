# Move All Config Data from Repo to R2

## Context

Currently, the app stores config data (`bands.json`, `audio/manifest.json`, per-song `config.json` files, band logos) in the git repo under `public/`. Audio stems and setlists are already on R2. The goal is to move **all** data to R2 so the repo contains only app code. This enables adding/editing/deleting songs and bands without git commits, following the pattern already established by setlists.

Work done on branch `feat/r2-config`.

---

## R2 Data Structure

```
R2 bucket:
  registry.json                           # band list (replaces bands.json)
  {bandId}/
    logo.png                              # band logo
    songs/
      index.json                          # per-band song catalog [{id, title, artist, audioBasePath}]
      {songId}/
        config.json                       # full song config
    song-{songId}/                        # audio stems (already exists, unchanged)
      {stem}.mp3
    setlists/                             # already exists, unchanged
      index.json
      {setlistId}.json
```

Key decisions:
- **Per-band song indexes** instead of global manifest — songs are always band-scoped, cleaner for CRUD
- **Audio stems stay at existing paths** (`{bandId}/song-{songId}/`) — no re-upload needed
- **`registry.json`** replaces `bands.json` — single fetch to bootstrap, contains full band configs with R2 logo URLs
- Song index entries drop the `path` field (R2 path is deterministic from `bandId + songId`), keep `audioBasePath`

---

## Phase 1: Infrastructure (non-breaking)

### 1.1 Create branch
```
git checkout -b feat/r2-config
```

### 1.2 Add `r2Url()` utility
- **File:** `src/utils/url.ts`
- Add `r2Url(path)` that builds `${VITE_R2_PUBLIC_URL}/${path}`
- `assetUrl()` stays for truly static assets (favicon, soundtouch-processor.js)

### 1.3 Extract R2 helpers in dev API
- **File:** `vite-plugin-config-api.ts`
- Extract reusable `r2ReadJson()`, `r2WriteJson()`, `r2DeleteKey()`, `r2PutFile()` from existing scattered R2 code (setlist endpoints already do this inline)

### 1.4 Write migration script
- **File:** `scripts/migrate-config-to-r2.ts`
- Read local `bands.json` and `manifest.json`
- For each band: upload logo, build + upload `songs/index.json`, upload each song's `config.json`
- Build + upload `registry.json` (bands with R2 logo URLs)
- Support `--dry-run`
- Verify uploaded data by re-fetching and validating with Zod

### 1.5 Update types and schemas
- **Files:** `src/audio/types.ts`, `src/config/schema.ts`
- `SongManifestEntry.path` → optional (kept for backwards compat during migration, removed in Phase 4)
- `BandConfig.logo` → will contain full R2 URL instead of relative path

---

## Phase 2: Switch app reads to R2 (atomic — land together)

### 2.1 BandPicker + BandApp
- **Files:** `src/components/band/BandPicker.tsx`, `src/components/band/BandApp.tsx`
- `fetch(assetUrl('bands.json'))` → `fetch(r2Url('registry.json'))`
- Logo `src`: use `band.logo` directly (now a full R2 URL)

### 2.2 SongList manifest fetch
- **File:** `src/components/song-select/SongList.tsx`
- `fetch(assetUrl('audio/manifest.json'))` → `fetch(r2Url(\`${bandId}/songs/index.json\`))`
- Add `currentBand` dependency (manifest is now per-band)

### 2.3 Song config fetch
- **File:** `src/components/song-select/SongList.tsx` (useSongLoader)
- `fetch(assetUrl(entry.path + '/config.json'))` → `fetch(r2Url(\`${bandId}/songs/${entry.id}/config.json\`))`
- `audioBasePath` for stems is unchanged

### 2.4 Admin pages
- **Files:** `src/admin/ManageBandsPage.tsx`, `src/admin/EditSongPage.tsx`, `src/admin/steps/ReviewStep.tsx`, `src/admin/SetlistModal.tsx`
- Update all `assetUrl('bands.json')` and `assetUrl('audio/manifest.json')` fetches to `r2Url()`

---

## Phase 3: Switch admin writes to R2

### 3.1 Refactor API endpoints
- **File:** `vite-plugin-config-api.ts`

| Endpoint | Change |
|----------|--------|
| `POST /api/bands` | Write `registry.json` to R2 (not local `bands.json`) |
| `POST /api/bands/{bandId}/logo` | Upload to `{bandId}/logo.png` on R2 |
| `POST /api/song/{songId}/config` | Write to `{bandId}/songs/{songId}/config.json` on R2 |
| `POST /api/manifest/add` | Write to `{bandId}/songs/index.json` on R2 |
| `POST /api/song/{songId}/rename` | Copy R2 config + audio, update R2 registry + index |
| `DELETE /api/song/{songId}` | Delete from R2, update R2 registry + index |

### 3.2 Add `bandId` to API routes
- Change `/api/song/{songId}/*` → `/api/bands/{bandId}/songs/{songId}/*`
- Remove `resolveBandForSong()` helper (no longer reads local filesystem)
- Update admin UI fetch calls to pass `bandId`

### 3.3 Stem upload flow
- `POST /api/r2/transcode-upload/{songId}` — unchanged (already uploads to R2; local temp dir for ffmpeg is fine)
- Raw stem upload (`POST /api/song/{songId}/upload`) — still writes to local temp, then transcode-upload moves to R2

---

## Phase 4: Cleanup

### 4.1 Delete data files from repo
- Delete `public/bands.json`
- Delete `public/audio/` entirely
- Delete `public/bands/` (logos)

### 4.2 Remove `SongManifestEntry.path` field
- **Files:** `src/audio/types.ts`, `src/config/schema.ts`
- Field is no longer needed — R2 path derived from `bandId + songId`

### 4.3 Simplify `.gitignore`
- Remove `public/audio/**/*.wav` and similar rules

### 4.4 Update deploy workflows
- **Files:** `.github/workflows/deploy.yml`, `.github/workflows/preview.yml`
- Verify no data files are expected in the build

### 4.5 Audit `assetUrl()` usage
- Should only remain for `favicon.svg` and `soundtouch-processor.js`

---

## Verification

1. **Dev:** Start dev server, navigate to band picker → loads bands from R2
2. **Dev:** Select band → song list loads from R2, songs play correctly
3. **Admin:** Add song wizard → config + index + registry all written to R2
4. **Admin:** Edit/rename/delete song → R2 updated correctly
5. **Admin:** Manage bands → registry.json updated on R2, logos uploaded
6. **Admin:** Setlists → unchanged behavior (already R2)
7. **Build:** `npm run build` → `dist/` contains no data files, only app code
8. **Deploy:** GitHub Pages serves only the app shell; all data fetched from R2 at runtime

---

## Critical Files

- `vite-plugin-config-api.ts` — all API endpoint refactoring
- `src/components/song-select/SongList.tsx` — core data loading (manifest + song config)
- `src/components/band/BandApp.tsx` + `BandPicker.tsx` — band registry loading
- `src/utils/url.ts` — new `r2Url()` helper
- `src/audio/types.ts` + `src/config/schema.ts` — type/schema updates
- `src/admin/` — all admin pages need fetch URL updates
- `scripts/migrate-config-to-r2.ts` — new migration script

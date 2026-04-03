# Exploration: Cloudflare R2 for External Audio Storage

**Date**: 2026-04-02
**Status**: Research complete, not yet implemented

## Goal

Move audio stem files out of the Git repository and into external cloud storage. Audio files (WAV/MP3) are too large for GitHub — a single song with 10+ stems can be hundreds of megabytes. The static site should fetch audio at runtime from cloud storage while config files (manifest.json, config.json, bands.json) remain in the repo as part of the build.

---

## Why Cloudflare R2

| Criteria | Google Drive | Cloudflare R2 | Backblaze B2 | GitHub LFS |
|----------|-------------|---------------|-------------|------------|
| Free storage | 15 GB (shared) | 10 GB | 10 GB | 1 GB |
| Free bandwidth | Quota-limited | Unlimited (no egress) | 1 GB/day | 1 GB/month |
| CORS support | No (blocked) | Full control | Configurable | Yes |
| Direct fetch | Broken (interstitial) | Clean public URLs | Yes | Yes |
| S3-compatible API | No | Yes | Yes | No |
| Browser upload | No | Via presigned URLs | Via presigned URLs | No |

**R2 wins** because: no egress fees (critical for streaming audio), proper CORS, S3-compatible tooling, and a free tier that easily covers a small band practice tool.

---

## Architecture

### Current Flow
```
Admin uploads stems → saved to public/audio/song-{id}/ on disk
Static site serves  → /audio/song-{id}/bass.mp3 (same origin)
```

### Proposed Flow
```
Admin uploads stems → browser uploads directly to R2 via presigned URL
Config stays local  → public/audio/song-{id}/config.json (in repo, part of build)
Static site plays   → fetches audio from https://{bucket}.r2.dev/song-{id}/bass.mp3
```

Key principle: **config is code, audio is data.** Config files are small, version-controlled, and part of the build. Audio files are large, binary, and stored externally.

---

## Upload Flow (Browser-Based)

When the admin creates or edits a song, stems are uploaded directly from the browser to R2. This avoids routing large files through a backend.

### Presigned URL Pattern

1. Admin selects stem files in AddSongWizard / EditSongPage
2. Frontend requests presigned upload URLs from the dev server:
   ```
   POST /api/r2/presign
   Body: { songId: "wiggle", files: ["bass.mp3", "melody.mp3"] }
   Response: { urls: { "bass.mp3": "https://...", "melody.mp3": "https://..." } }
   ```
3. Frontend uploads each file directly to R2 using the presigned URL:
   ```ts
   await fetch(presignedUrl, { method: 'PUT', body: file });
   ```
4. Config.json is saved locally as before (via existing `/api/song/{id}/config` endpoint)

### Presigned URL Generation

Two options for generating presigned URLs:

#### Option A: Dev Server Endpoint (simpler, dev-only)
Add an endpoint to `vite-plugin-config-api.ts` that uses the `@aws-sdk/s3-request-presigner` package (works with R2's S3-compatible API) to generate presigned PUT URLs.

```ts
// vite-plugin-config-api.ts
// POST /api/r2/presign
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,       // https://<account-id>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// For each file, generate a presigned PUT URL:
const url = await getSignedUrl(s3, new PutObjectCommand({
  Bucket: process.env.R2_BUCKET,
  Key: `song-${songId}/${filename}`,
}), { expiresIn: 3600 });
```

#### Option B: Cloudflare Worker (production-ready)
Deploy a small Worker that validates requests and returns presigned URLs. This would be needed for the production admin portal but is overkill for the dev-only workflow today.

**Recommendation: Start with Option A.** It keeps everything in the existing dev server and can be swapped for a Worker later when the admin portal becomes a separate service.

---

## Playback Flow

### How Audio Fetching Changes

Currently in `AudioEngine.ts:109`:
```ts
const url = `${basePath}/${stemConfig.file}`;
// basePath = "/audio/song-test", file = "bass.mp3"
// Result: "/audio/song-test/bass.mp3" (same-origin)
```

With R2, `basePath` becomes an absolute URL:
```ts
const url = `${basePath}/${stemConfig.file}`;
// basePath = "https://practice-portal.r2.dev/song-test", file = "bass.mp3"
// Result: "https://practice-portal.r2.dev/song-test/bass.mp3"
```

**The AudioEngine code doesn't need to change** — it already concatenates `basePath` + `file`. We just need the manifest's `path` field to be the R2 base URL instead of a relative path.

### Manifest Change

```json
{
  "songs": [
    {
      "id": "st-james",
      "title": "St. James",
      "artist": "Unknown",
      "path": "https://practice-portal.r2.dev/song-st-james"
    }
  ]
}
```

### Config.json Location

Config stays local. The song selection flow in `SongList.tsx` currently fetches config from:
```ts
const configUrl = `/${entry.path}/config.json`;
```

This would need a small change — config is always local, audio is always R2:
```ts
const configUrl = `/audio/song-${entry.id}/config.json`;
// Audio basePath comes from a separate field or is derived from R2 base URL + song ID
```

**Option:** Add an `audioBasePath` field to manifest entries (or derive it from an env var + song ID). The `path` field would remain the local config path, and `audioBasePath` would point to R2.

```json
{
  "id": "st-james",
  "title": "St. James",
  "artist": "Unknown",
  "path": "audio/song-st-james",
  "audioBasePath": "https://practice-portal.r2.dev/song-st-james"
}
```

If `audioBasePath` is absent, fall back to `/${path}` (local files) for backwards compatibility.

---

## R2 Setup Steps

### 1. Create Cloudflare Account + R2 Bucket
- Sign up at cloudflare.com (free)
- Dashboard → R2 → Create Bucket → name it `practice-portal-audio`
- Enable public access (Settings → Public Access → Allow)
- Note the public URL: `https://practice-portal-audio.<account>.r2.dev`

### 2. Configure CORS
In R2 bucket settings, add a CORS rule:
```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "https://your-username.github.io"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

> **Note:** R2 does not support partial wildcards (e.g. `http://localhost:*`).
> Use exact origins, or `*` to allow all. Add additional dev server ports as needed.

### 3. Create API Token
- R2 → Manage R2 API Tokens → Create API Token
- Permissions: Object Read & Write
- Scope: the `practice-portal-audio` bucket only
- Save the Access Key ID and Secret Access Key

### 4. Local Environment
Create `.env` (gitignored):
```
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<key>
R2_SECRET_ACCESS_KEY=<secret>
R2_BUCKET=practice-portal-audio
R2_PUBLIC_URL=https://practice-portal-audio.<account>.r2.dev
```

---

## Migration Path for Existing Songs

1. Install `@aws-sdk/client-s3` as a dev dependency
2. Write a one-time migration script (`scripts/migrate-to-r2.ts`):
   - Read `manifest.json`
   - For each song, upload all audio files from `public/audio/song-{id}/` to R2
   - Update manifest entries with `audioBasePath`
   - Skip `config.json` (stays local)
3. After migration, remove audio files from `public/audio/song-*/` (keep config.json)
4. Add `*.mp3` and `*.wav` to `.gitignore` under `public/audio/`

---

## Codebase Changes Required

| File | Change | Scope |
|------|--------|-------|
| `src/audio/types.ts` | Add `audioBasePath?: string` to `SongManifestEntry` | Small |
| `src/config/schema.ts` | Add `audioBasePath` to Zod schema | Small |
| `src/components/song-select/SongList.tsx:30-35` | Use `audioBasePath` when calling `engine.loadSong()` | Small |
| `src/audio/AudioEngine.ts` | No change needed (already uses basePath param) | None |
| `vite-plugin-config-api.ts` | Add `POST /api/r2/presign` endpoint | Medium |
| `src/admin/steps/ReviewStep.tsx` | Upload stems to R2 via presigned URLs | Medium |
| `src/admin/EditSongPage.tsx` | Upload new stems to R2 via presigned URLs | Medium |
| `manifest.json` | Add `audioBasePath` to each song entry | Small |
| `.env` / `.gitignore` | R2 credentials, ignore audio files | Small |
| `package.json` | Add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | Small |

---

## R2 Bucket Structure

```
practice-portal-audio/
├── song-st-james/
│   ├── St James Kick.wav
│   ├── St James Snare.wav
│   └── ...
├── song-wiggle-sooza/
│   ├── Wiggle Trumpet 1.mp3
│   └── ...
└── song-gunk-palace-sooza/
    └── ...
```

Mirrors the current `public/audio/song-{id}/` structure, minus `config.json`.

---

## Audio Format & Optimizations

### Recommended Format: MP3 CBR 256 kbps

| Format | Size (5 min stereo) | Quality when slowed | Safari | Verdict |
|--------|-------------------|---------------------|--------|---------|
| WAV 16-bit | ~50 MB | Perfect | Yes | Too large for web |
| FLAC | ~28 MB | Perfect | **No** | No Safari |
| **MP3 CBR 256** | **~6 MB** | **Great to ~40% speed** | **Yes** | **Best pick** |
| AAC 192 | ~4 MB | Great | Yes | Harder toolchain |
| Opus 128 | ~3 MB | Excellent | **No** | Future upgrade path |

**Why CBR over VBR:** VBR allocates fewer bits to sustained notes — exactly the passages musicians slow down and practice. CBR ensures consistent quality throughout.

**Why this matters for slow-down:** SoundTouch operates on decoded PCM, but lossy compression artifacts are baked into those samples. Time-stretching expands transients and exposes artifacts that are normally masked at full speed. At 256 kbps CBR, artifacts stay inaudible down to ~40% speed.

### Server-Side Transcoding on Upload

When the admin uploads stems (typically WAV from a DAW), the server should transcode to MP3 256 CBR before storing in R2. This keeps the workflow simple — admins upload whatever they have, the system normalizes it.

**Pipeline:**
```
Admin uploads WAV/FLAC/MP3
        ↓
Dev server receives file
        ↓
ffmpeg transcodes to MP3 CBR 256 (if not already MP3 256)
        ↓
Upload transcoded file to R2 via presigned URL
        ↓
config.json references the .mp3 filename
```

**Implementation:**
- Use `fluent-ffmpeg` (npm) or shell out to `ffmpeg` directly
- Transcode command: `ffmpeg -i input.wav -codec:a libmp3lame -b:a 256k -ar 44100 output.mp3`
- Skip transcoding if the input is already MP3 ≥256 kbps CBR (detect with `ffprobe`)
- Transcode happens in the dev server's upload handler before generating the presigned URL
- Requires `ffmpeg` installed on the dev machine (standard for audio work)

### Additional Optimizations

#### 1. Mono stems (~50% size reduction)
Most individual instrument stems are mono — a single trumpet, a kick drum, a bass guitar. Stereo is only needed for overheads, piano, or pre-mixed groups. Panning is handled by the mixer's `panNode`, not by the audio file.

- Auto-detect: if L and R channels are identical (or nearly), save as mono
- Admin override: checkbox per stem to force stereo (for stereo-recorded instruments)
- `ffmpeg -i input.wav -ac 1 -codec:a libmp3lame -b:a 128k output.mp3` (128k mono ≈ 256k stereo quality)
- **Impact:** A 10-stem song drops from ~60 MB to ~30 MB

#### 2. Sample rate reduction (44.1 kHz is fine)
DAWs sometimes export at 48 or 96 kHz. For practice playback, 44.1 kHz is more than adequate. Downsample during transcode.

- `ffmpeg -ar 44100` (already in the transcode command above)
- **Impact:** Modest — mostly affects files exported at 96 kHz

#### 3. Lazy stem loading
Don't load all stems upfront. Load the first 2-3 most important stems (e.g. the group "Full Mix" or "Rhythm Section"), then load remaining stems in the background or on-demand when unmuted.

- Requires changes to `AudioEngine.loadSong()` — load essential stems first, return, then background-load the rest
- Show a loading indicator per stem in the mixer panel
- **Impact:** Perceived load time drops dramatically for songs with many stems

#### 4. HTTP caching headers
Configure R2 to serve audio with long `Cache-Control` headers (e.g. `max-age=31536000, immutable`). Audio files don't change — if a stem is re-recorded, it gets a new filename. This means:

- First load fetches from R2
- Subsequent loads hit browser cache (instant)
- **Impact:** Returning users load songs almost instantly

#### 5. Content-Range support
R2 supports range requests natively. The browser can start decoding audio before the full file downloads. Web Audio's `decodeAudioData()` needs the full file, but a future optimization could use `MediaSource` extensions for streaming decode of the first N seconds while the rest loads.

---

## Open Questions

1. **Dual-mode or R2-only?** Keep supporting local audio files (for dev/offline) alongside R2, or fully commit to R2? The `audioBasePath` fallback approach supports both.

2. **Upload progress:** The current upload flow uses `FormData` to the dev server. Presigned PUT uploads to R2 can use `XMLHttpRequest` or `fetch` with a ReadableStream to track progress — worth implementing since stems are large.

3. **Delete/replace:** When a stem is removed or replaced, should we delete the old file from R2? The S3 API supports `DeleteObject`, but it adds complexity. Could defer this and do manual cleanup.

4. **Auth for presigned URL endpoint:** In dev it's open. In production (admin portal), this endpoint needs auth so random users can't generate upload URLs.

---

## Implementation Order (When Ready)

### Phase 1: Core R2 integration
1. Create Cloudflare account + R2 bucket + API token
2. `npm install -D @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
3. Add `.env` with R2 credentials, update `.gitignore`
4. Add `audioBasePath` to types, schema, manifest
5. Update `SongList.tsx` to use `audioBasePath` for audio loading
6. Add `POST /api/r2/presign` to `vite-plugin-config-api.ts`
7. Update `ReviewStep.tsx` to upload via presigned URLs
8. Update `EditSongPage.tsx` for the same

### Phase 2: Transcoding pipeline
9. Ensure `ffmpeg` is available (document as prerequisite)
10. Add transcode step to upload handler: WAV/FLAC → MP3 CBR 256, downsample to 44.1 kHz
11. Auto-detect mono stems (identical L/R channels) → encode as mono 128 kbps
12. Skip transcode if input is already MP3 ≥256 kbps CBR
13. Update config.json filenames to reference the transcoded .mp3

### Phase 3: Optimizations
14. Set R2 `Cache-Control: max-age=31536000, immutable` on uploaded audio
15. Consider lazy stem loading (load essential stems first, background-load rest)

### Phase 4: Migration
16. Write migration script for existing local songs → R2
17. Test end-to-end: create song → upload WAV stems → verify transcode → play from R2 → slow down → verify quality

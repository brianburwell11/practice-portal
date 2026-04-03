# Deploy Practice Portal to GitHub Pages with CI/CD

## Context

The practice portal is a static Vite + React SPA with no server-side dependencies in production. It's a perfect candidate for GitHub Pages. Currently, all asset paths are hardcoded to `/` (root), and there's no deployment pipeline. We need to:
1. Fix paths so the app works from a subdirectory (`/practice-portal/`)
2. Set up CI/CD with GitHub Actions for production deploys
3. Support PR preview (sandbox) environments for testing before merge

## Approach: Unified `gh-pages` branch

Both production and PR previews deploy to the `gh-pages` branch using `peaceiris/actions-gh-pages`. This avoids conflicts between the `actions/deploy-pages` API and branch-based deploys.

- **Production** (`main` push): builds and deploys to the root of `gh-pages` (with `keep_files: true` to preserve preview dirs)
- **PR previews** (pull_request): builds and deploys to `pr/<number>/` subdirectory
- **Cleanup** (PR close): removes the `pr/<number>/` directory

GitHub Pages source: "Deploy from a branch" > `gh-pages` > `/ (root)`

---

## Phase 1: Asset path infrastructure

### 1.1 Create `src/utils/url.ts`
```ts
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
```
Strips leading slash to avoid double-slash since `BASE_URL` always ends with `/`.

### 1.2 Update `vite.config.ts`
Add configurable `base` path:
```ts
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), tailwindcss(), configApiPlugin()],
})
```
- Local dev: defaults to `/`
- Production CI: `VITE_BASE_PATH=/practice-portal/`
- PR preview CI: `VITE_BASE_PATH=/practice-portal/pr/123/`

### 1.3 Update `src/main.tsx` — add `basename` to BrowserRouter
```tsx
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
<BrowserRouter basename={basename}>
```
Vite syncs `import.meta.env.BASE_URL` from the `base` config automatically.

---

## Phase 2: Fix hardcoded paths

Replace all hardcoded `fetch('/...')` calls with `assetUrl()`. Admin `/api/...` calls are dev-only and stay as-is.

| File | Change |
|------|--------|
| `src/components/band/BandPicker.tsx:11` | `fetch('/bands.json')` → `fetch(assetUrl('bands.json'))` |
| `src/components/band/BandApp.tsx:14` | `fetch('/bands.json')` → `fetch(assetUrl('bands.json'))` |
| `src/components/song-select/SongList.tsx:17` | `fetch('/audio/manifest.json')` → `fetch(assetUrl('audio/manifest.json'))` |
| `src/components/song-select/SongList.tsx:38` | `` `/${entry.path}/config.json` `` → `` assetUrl(`${entry.path}/config.json`) `` |
| `src/components/song-select/SongList.tsx:43` | `` `/${entry.path}` `` fallback → `assetUrl(entry.path)` |
| `src/admin/ManageBandsPage.tsx:38,43` | Same pattern for `/bands.json` and `/audio/manifest.json` |
| `src/admin/EditSongPage.tsx:37,42` | Same pattern for manifest and config fetches |
| `src/admin/steps/ReviewStep.tsx:87` | `fetch('/bands.json')` → `fetch(assetUrl('bands.json'))` |

**Band logos**: `bands.json` stores paths like `/bands/sooza-brass-band/logo.png`. These are rendered via `<img src={band.logo}>` in `BandPicker.tsx:34` and likely elsewhere. Need to prefix these at render time with `assetUrl()`.

---

## Phase 3: SPA routing fallback

Add a `cp dist/index.html dist/404.html` step in the CI workflow after build. GitHub Pages serves `404.html` for any unknown path, which loads the SPA and lets React Router handle routing. No separate 404.html file needed in the repo.

---

## Phase 4: GitHub Actions workflows

### 4.1 `.github/workflows/deploy.yml` — Production
- **Trigger:** push to `main`
- **Steps:** checkout → setup node 22 + npm cache → `npm ci` → build with `VITE_BASE_PATH=/practice-portal/` → copy 404.html → deploy to `gh-pages` root with `keep_files: true`
- **Concurrency:** `group: pages-deploy`, `cancel-in-progress: false`

### 4.2 `.github/workflows/preview.yml` — PR Preview
- **Trigger:** pull_request `[opened, synchronize, reopened]`
- **Steps:** checkout → setup node → `npm ci` → build with `VITE_BASE_PATH=/practice-portal/pr/<number>/` → copy 404.html → deploy to `gh-pages` at `pr/<number>/` → post/update comment with preview URL
- **Concurrency:** `group: preview-<number>`, `cancel-in-progress: true`
- **Permissions:** `contents: write`, `pull-requests: write`

### 4.3 `.github/workflows/preview-cleanup.yml` — Cleanup
- **Trigger:** pull_request `[closed]`
- **Steps:** checkout `gh-pages` → `rm -rf pr/<number>` → commit and push if changes exist

---

## Phase 5: Manual repo setup

After merging, configure in GitHub repo Settings:
1. **Pages** → Source: "Deploy from a branch" → `gh-pages` / `/ (root)`
2. **Environments** → optionally add protection rules to `production`

---

## Files to create/modify

| Action | File |
|--------|------|
| Create | `src/utils/url.ts` |
| Create | `.github/workflows/deploy.yml` |
| Create | `.github/workflows/preview.yml` |
| Create | `.github/workflows/preview-cleanup.yml` |
| Modify | `vite.config.ts` |
| Modify | `src/main.tsx` |
| Modify | `src/components/band/BandPicker.tsx` |
| Modify | `src/components/band/BandApp.tsx` |
| Modify | `src/components/song-select/SongList.tsx` |
| Modify | `src/admin/ManageBandsPage.tsx` |
| Modify | `src/admin/EditSongPage.tsx` |
| Modify | `src/admin/steps/ReviewStep.tsx` |

---

## Verification

1. **Local dev** still works: `npm run dev` (base defaults to `/`)
2. **Production build**: `VITE_BASE_PATH=/practice-portal/ npm run build && npx vite preview --base /practice-portal/` — verify all pages, asset loading, audio playback, and band logos work
3. **Push to main** → confirm GitHub Action runs → visit `https://brianburwell11.github.io/practice-portal/`
4. **Open a test PR** → confirm preview deploys → visit preview URL from the bot comment
5. **Close the PR** → confirm cleanup workflow removes the preview directory

# Setlist Feature Implementation Plan

## Context
Band admins can create ordered setlists from a band's song library. Setlists filter the song dropdown, enable prev/next navigation, and allow duplicate songs (e.g., encores). The feature follows existing patterns: native HTML5 drag-and-drop for reordering, Zustand for state, JSON files for persistence, and dev-mode gating for admin features.

## Data Model

IDs are prefixed with `setlist-` (e.g., `setlist-friday-gig`). All setlist data is stored in **R2** at `{bandId}/setlists/`.

**Setlist config** (R2: `{bandId}/setlists/{setlistId}.json`):
```json
{ "id": "setlist-friday-gig", "name": "Friday Gig", "songIds": ["wiggle-sooza", "bella-ciao-sooza", "wiggle-sooza"] }
```

**Setlist index** (R2: `{bandId}/setlists/index.json`):
```json
{ "setlists": [{ "id": "setlist-friday-gig", "name": "Friday Gig" }] }
```

Client reads via R2 public URL: `{R2_PUBLIC_URL}/{bandId}/setlists/index.json` and `{R2_PUBLIC_URL}/{bandId}/setlists/{setlistId}.json`.

Using `songIds: string[]` (not objects) for simplicity. Duplicates are plain repeated entries.

---

## Phase 1: Data layer

### 1. Types — `/src/audio/types.ts`
Add `SetlistConfig` (id, name, songIds) and `SetlistIndex` (setlists array of {id, name}).

### 2. Zod schemas — `/src/config/schema.ts`
Add `setlistConfigSchema` and `setlistIndexSchema`.

### 3. API endpoints — `/vite-plugin-config-api.ts`
- **POST `/api/bands/{bandId}/setlists/{setlistId}`** — Upload setlist JSON to R2 at `{bandId}/setlists/{setlistId}.json`, then read/upsert/upload `index.json` at `{bandId}/setlists/index.json`
- **DELETE `/api/bands/{bandId}/setlists/{setlistId}`** — Delete from R2, update index.json in R2

Uses existing `getR2Client()` and `PutObjectCommand`/`DeleteObjectCommand` patterns already in the file. Index.json is fetched from R2 (via `GetObjectCommand` or public URL), modified, and re-uploaded.

### 4. Zustand store — new `/src/store/setlistStore.ts`
```
index: { id, name }[] | null
activeSetlist: SetlistConfig | null
activeIndex: number  (position in songIds, needed for duplicates + prev/next)
```

---

## Phase 2: Admin modal

### 5. SetlistModal — new `/src/admin/SetlistModal.tsx`
- Modal overlay (same pattern as DeleteSongModal — fixed inset-0, backdrop, centered card)
- **Props**: `{ setlistId?: string; onClose: () => void }` — edit mode if setlistId provided
- **Name input** at top
- **Song picker**: band's songs with "+" button to append
- **Ordered list**: drag-and-drop reorder (copy EditSongPage D&D pattern — dragIdx/dropIdx, &#x2630; handle, opacity-40/ring-1), "x" to remove
- **Save**: POST to API, refresh store index, close modal
- Derive setlist ID: `setlist-` + slug of name (e.g., `setlist-friday-gig`)

### 6. Dev toolbar button — `/src/App.tsx`
Add "Create Setlist" button in dev toolbar. Add state for modal visibility. Render SetlistModal conditionally.

---

## Phase 3: Setlist selection & filtering

### 7. Load setlist index — `/src/components/song-select/SongList.tsx`
Add effect in `SongList` (headless component) to fetch the setlist index when currentBand changes. Store in setlistStore. Handle 404 gracefully (no setlists yet).

**R2 URL resolution**: Expose `R2_PUBLIC_URL` via Vite env as `VITE_R2_PUBLIC_URL` in `.env`. Access on client via `import.meta.env.VITE_R2_PUBLIC_URL`. Vite exposes `VITE_` prefixed vars by default.

### 8. Setlist dropdown — `/src/App.tsx` header
Add a `<select>` in the header (right side) with "All Songs" default + setlists from index.
On change: fetch the setlist JSON from R2 public URL, set `activeSetlist` and `activeIndex = 0`, trigger loading first song.

### 9. Filter song dropdown — `/src/components/song-select/SongList.tsx`
Modify `filteredSongs` in `useSongLoader`:
- If `activeSetlist`: map `songIds` to manifest entries (preserving order and duplicates)
- Otherwise: existing band filter

Modify `SongSelectDropdown`:
- When setlist active, use array index as `<option>` value (not songId, since duplicates collide)
- Number songs: `1. Wiggle — SOOZA`

### 10. Export `useSongLoader`
Export it from SongList.tsx so App.tsx can access `handleSelect` for prev/next.

---

## Phase 4: Prev/Next navigation

### 11. Prev/Next bar — `/src/App.tsx`
When `activeSetlist` is set, render a nav bar between header and dev toolbar:
```
[ < Prev Song Title ]  [Song Dropdown]  [ Next Song Title > ]
```
- Prev/Next are clickable, load immediately via `handleSelect`
- Disabled at boundaries (first/last)
- Show song titles (resolved from manifest) as the link text

---

## Phase 5: Edit & delete setlists

### 12. Edit/delete controls
- DEV-only edit icon next to setlist dropdown opens SetlistModal with setlistId (edit mode)
- Delete option inside the modal or as a separate button
- On delete: DELETE API call, refresh index, reset activeSetlist to null

---

## Files to create
- `/src/store/setlistStore.ts`
- `/src/admin/SetlistModal.tsx`

## Files to modify
- `.env` — add `VITE_R2_PUBLIC_URL` (same value as existing `R2_PUBLIC_URL`)
- `/src/audio/types.ts` — add SetlistConfig, SetlistIndex types
- `/src/config/schema.ts` — add Zod schemas
- `/vite-plugin-config-api.ts` — add POST/DELETE setlist endpoints (R2 upload/delete + index.json management)
- `/src/App.tsx` — dev toolbar button, setlist dropdown in header, prev/next nav, modal rendering
- `/src/components/song-select/SongList.tsx` — setlist-aware filtering, index loading, export useSongLoader

## Verification
1. Create a setlist via the modal — verify JSON files uploaded to R2 at `{bandId}/setlists/`
2. Refresh page — setlist dropdown should show the created setlist
3. Select a setlist — song dropdown filters to setlist songs in order, first song loads
4. Prev/next buttons work, disabled at boundaries
5. Duplicate songs in a setlist render correctly, each navigable independently
6. Edit a setlist — name and song order changes persist
7. Delete a setlist — R2 files removed, dropdown reverts to "All Songs"
8. `npm run build` passes (TypeScript + Vite)

# Future Ideas

## 1. GitHub Pages Deployment + Admin Portal Split

- Deploy a static site for end users (band members) via GitHub Pages
- Separate admin portal with server-side functionality for song prep:
  adding songs, updating the manifest, tapMap editing, config management
- Admin prepares everything so the static site can be built from that data

## 2. Multi-Band Routing

- Single repo serving multiple bands at different routes
  (e.g. `/dirty-chai`, `/sooza-brass-band`)
- Light customization per band (logo, colors), same core features
- Private tool — band members only
- **Open question:** separate manifests per band vs. one manifest with band grouping

## 3. Auto-Generate Markers from Click Track

- Transient detection on click track audio to auto-generate tapMap beat markers
- Test case: St James already has a click track stem

## 4. Metronome / Click Pattern Editor

- Configure click accents, subdivisions, and time signature changes per section
- Builds on existing tapMap section/measure/beat structure

## 5. External Audio Storage

- Audio files are too large for GitHub — need external storage
  (Google Drive, CDN, or similar)
- **Open question:** runtime fetch vs. build-time pull vs. admin-managed upload to CDN

## 6. Sheet Music Display (MusicXML / MuseScore)

Shipped: synced scrolling strip, a page view and full screen, phones, and
MuseScore files drawn exactly as MuseScore lays them out. See the docs page
`sheet-music-page-view-plan`. Still open:

- Host extra score fonts (e.g. Bebas Neue) and warn on upload when a score
  names a font the app doesn't have
- Check on a real iPhone: safe areas, the screen staying awake, the home
  screen app
- Before merging to main: where the app's browser source is published
  (muse-encore is GPL-3.0)

## 7. Setlists

- Create and load named setlists (ordered list of songs)
- Persisted in browser localStorage
- Scoped per band

## 8. Timestamped Song Notes

- Add text notes anchored to specific timestamps in a song
- Displayed as markers on the waveform timeline
- Two layers: admin notes (saved in config.json, visible to all band members)
  and personal notes (browser localStorage, per user)

## 9. Clean Up Incomplete Song Uploads

- If a song upload fails partway through, partial files may be left on R2
- Detect incomplete uploads (e.g. audio uploaded but config write failed, or vice versa)
  and clean up any artifacts so the server doesn't end up with orphaned files

## 10. Lazy Stem Loading (Monitor)

- Currently all stems are fetched and decoded before playback is available
- If load times become a problem with many stems on R2, consider loading
  essential stems first (e.g. full mix or rhythm section) and background-loading the rest
- Monitor real-world usage before implementing — may not be necessary
  with browser caching (Cache-Control: immutable) after the first load

---
title: "Faster Song Loading"
description: "A performance checklist run against the app, and the changes that cut the wait between opening a song link and pressing play."
pubDate: "Nov 20 2026"
tags: ["performance", "audio", "loading", "plan"]
---

**Goal:** shorten the time from opening a song link to being able to press play. Page load was already in good shape, so the work is on the song-load path. The earlier work is in [Faster Loading with Caching](/docs/load-time-caching-plan/).

## The checklist

| Item | Verdict |
|---|---|
| Compress images | Fine. Shipped images are small. Band logos are stored as uploaded |
| Lazy load | Done. Routes, modals and score views were already split; the legal pages now are too |
| Smaller JS bundles | The 5 MB score engine and 22 MB of notation fonts load only for sheet music |
| Self-host fonts | Done (`@fontsource`) |
| Database indexes | Done |
| No queries in loops | The setlist screens fetched every song's config. Fixed below |
| Paginate long lists | Not needed at band size |
| Cache repeat requests | Done (service worker, ETags, immutable assets) |
| CDN | No CDN. The Fly machine sleeps when idle, so the first visit waits for it to boot. **On hold:** no always-on server for now |
| Remove unused packages | Only `jszip` overlaps `fflate` |
| Loading skeletons | Done |
| Background jobs | Done (Postgres job queue for transcodes) |
| Autoplay video | Not used |
| Compress JSON | Was gzip, done synchronously. Now brotli or gzip, off the event loop |
| Batch database inserts | Mostly done already |
| Waterfalls | Opening a song link ran about 9 steps one after another. Shortened below |

## Changes

- [x] **Decode stems together.** `AudioEngine.loadSong` decoded audible stems one at a time. They now decode in parallel (all at once on desktop, two at a time on phones to limit memory), and each waveform is computed as its stem finishes. Stems keep their config order.
- [x] **Start a band page's downloads together** (`src/data/prefetch.ts`):
  - The registry starts as soon as the page loads, before the band page's code arrives.
  - Each device remembers which band id a route belongs to. On a return visit, the band, song list and setlist index start at the same time as the registry. On a first visit they start as soon as the registry names the band.
  - The player's code starts with them, instead of after `band.json`.
  - Once the song list arrives, the config of the song in `?song=` starts. `readDoc` picks it up, and a waiting offline edit still takes priority.
  - Each prefetched response is used once, and dropped after 30 s if nothing used it.
  - A guest link loads first, since it changes what the browser may see.
- [x] **Key and length in the song list.** The discography now includes each song's `key` and `durationSeconds`. `useSongMeta` reads them there. The setlist home, the setlist editor and All Setlists no longer fetch every config, except as a fallback for a song list cached before this change.
- [x] **JSON compression:** brotli (quality 5) when the browser accepts it, else gzip, both asynchronous.
- [x] **Legal pages** are their own chunks. The entry chunk went from 124 KB to 117 KB gzipped.
- [x] Tests: `src/data/prefetch.test.ts`.

## Not done

- **Trimming the offline download.** The score engine registers every notation font at startup (`initEngravingFonts` in `vendor/muse-encore/src/engraving/engravingmodule.ts`), so none of them are unused, and leaving any out would break sheet music offline. Loading only the fonts a score uses would mean changing the vendored engine.
- **Delaying the score engine until the stems finish.** It loads alongside the audio on purpose (see the caching plan). Revisit if the waterfall shows it competing with the stems.
- **Streaming long songs** instead of holding them fully decoded, to save memory on phones. Phones already decode at 22.05 kHz mono, so this matters only for long songs with many stems.

## Check

- [ ] **Before and after:** with DevTools (Network plus Performance, Slow 4G, 4x CPU slowdown), open a song link `/:band?song=x` twice:
  - **First visit:** the band, song list and player code start together once the registry arrives.
  - **Second visit:** they start with the registry, and the config starts as the song list lands.
- [ ] Opening a song with many stems: time to play is close to the slowest single stem, and the waveform appears for each.
- [ ] On an iPhone, a long song with many stems loads without the page reloading.
- [ ] The setlist home, the setlist editor and All Setlists show keys and lengths with no per-song `config.json` requests.
- [ ] `/api/data` responses show `content-encoding: br` in Chrome.
- [ ] A guest link, a members-only band and offline playback still work.
- [ ] Lighthouse on a band page.

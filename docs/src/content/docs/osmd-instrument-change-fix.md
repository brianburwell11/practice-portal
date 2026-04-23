---
title: "OSMD Instrument-Change Rendering Fix"
description: "Preprocess MusicXML client-side so OpenSheetMusicDisplay renders mid-piece instrument changes (e.g. trumpet doubling tambourine) without clef / pitch glitches."
pubDate: "Apr 23 2026"
tags: ["sheet-music", "osmd", "musicxml", "planning"]
---

# OSMD Instrument-Change Rendering Fix

## Context

Some MusicXML scores use the `<instrument-change>` element to have one player double on a second instrument mid-piece — a trumpeter who puts down the horn to play a tambourine pattern and picks it back up, for example. In MusicXML this lives inside a single `<part>`: multiple `<score-instrument>` entries declared up front, then `<instrument-change>` events (paired with clef changes to `<sign>percussion</sign>`) inside the part body as the player swaps between them.

**OpenSheetMusicDisplay 1.9.7 doesn't render this correctly.** The observed symptoms on any score that uses the pattern:

- Notes after the switch render at positions calibrated against the previous clef, so tambourine notes get pitched against a trumpet staff (or vice versa when it switches back).
- OSMD keeps the original 5-line staff even when `<sign>percussion</sign>` asks for a 1-line percussion staff.
- `<part-name-display>` updates from the `<instrument-change>` are ignored — the sidebar label keeps the original part name.
- Clef state can leak into the first trumpet section after a tambourine section, displacing those pitches too.

The fix doesn't require touching or forking OSMD. MusicXML reaches the renderer via a client-side fetch + unzip in `InfiniteScoreRenderer.tsx`, so we can transform the XML string in the browser before `osmd.load()` sees it.

---

## Approach: split instrument-change parts client-side

Add a MusicXML transform that runs on the unzipped XML string before OSMD parses it. For any `<part>` containing `<instrument-change>`, split it into N sibling `<part>`s (one per distinct instrument), filling each with whole-measure rests during sections that belong to the other instruments. OSMD renders each as a plain single-instrument staff with a single clef, which it already handles correctly.

Apply the transform at **render time**, not upload time:

- The splitter logic can be improved without re-uploading every affected score.
- The original `.mxl` on R2 stays untouched (preserves round-trip fidelity with MuseScore exports).
- Cost is one DOM walk per song load — negligible.

Alternative rejected: preprocess at upload time inside `prepareSheetMusicUpload()`. Harder to iterate on, harder to back out, and rewrites bytes the admin didn't ask to be rewritten.

---

## Critical files

- `src/components/sheet/InfiniteScoreRenderer.tsx` (lines 137–271) — fetches → unzips → calls `osmd.load(xmlText)`. Hook point for the transform is between the unzip/decode block and the load call.
- `src/audio/unfoldRepeats.ts` (`parseMusicXML`, line ~86) — existing DOMParser-based MusicXML walker. Pattern to mirror; no new XML parsing dependency needed.
- `src/admin/utils/sheetMusic.ts` (lines 121–153) — client-side upload conversion. Not modified by this plan; noted here only because it's the alternative hook point if we ever move the transform upstream.

---

## Phases

### Phase 1 — Splitter utility

- [ ] Create `src/audio/splitInstrumentChanges.ts` exporting `splitInstrumentChanges(xmlText: string): string`.
- [ ] Early-return the input unchanged when no `<part>` contains `<instrument-change>` — the common case must be a no-op.
- [ ] For each affected `<score-part>` + `<part>` pair, walk the measures and group them by the currently-active instrument id (track `<instrument id="...">` references and update on each `<instrument-change>`).
- [ ] Emit one new `<score-part>` + `<part>` per distinct instrument, copying only that instrument's `<score-instrument>` and `<midi-instrument>` declarations. Use the `<part-name-display>` text from the `<instrument-change>` (e.g. "Tambourine") as the new part's `<part-name>` so the sidebar label reads correctly.
- [ ] In each split part, every measure is either (a) a copy of the original when this part's instrument is active, or (b) a tacet: `<note><rest measure="yes"/><duration>{measureDuration}</duration></note>` with the same measure number, width, attributes (clef/key/time), and system-break hints.
- [ ] Serialize the modified DOM with `XMLSerializer` and return.

Edge cases that will absorb most of the implementation effort:

- [ ] Multiple voices or multiple staves inside a single part.
- [ ] `<print new-system="yes">` and other layout hints — must be replicated on every split so system breaks align across sibling parts.
- [ ] Repeat barlines and voltas — must appear on every split part or the global unfold calculation diverges.
- [ ] Per-measure attributes (clef/key/time changes) — keep on the part whose instrument is active in that measure; ensure tacet measures still carry at minimum a clef or they won't render.
- [ ] Direction elements (rehearsal marks, tempo) — keep on the original first part to avoid duplicating them across staves.

### Phase 2 — Wire into the renderer

- [ ] In `src/components/sheet/InfiniteScoreRenderer.tsx`, after the existing unzip/decode block (around line 207) and before `osmd.load(xmlText)` (line 210), call `xmlText = splitInstrumentChanges(xmlText)`.
- [ ] Ensure the `parseMusicXML(xmlText)` call used for repeat-unfold (lines ~220) receives the same split text, so unfolded measure counts stay consistent across the two parsers.

### Phase 3 — Verification fixtures + dev affordance

- [ ] Add a stripped reproduction of the "Sooza" score (or equivalent) under a fixtures directory as a regression target.
- [ ] Optional: when the splitter fires, emit a one-line `console.info` with how many parts were split and how many output parts were produced. Cheap signal while iterating.

---

## Verification

1. `npm run dev`, load the affected song. Each doubling part should show two stacked single-instrument staves (trumpet with treble clef + rests during tambourine sections; tambourine with percussion clef + rests during trumpet sections). No mid-staff clef swaps, no displaced pitches.
2. Load a song with no `<instrument-change>` — should render identically to before, with byte-for-byte equivalent `xmlText` reaching OSMD.
3. `npm run build` must pass tsc + vite.
4. Play the affected song against its tapMap and confirm the repeat-unfolded measure count matches pre-split (we duplicate measures across parts but don't add new ones).

---

## Out of scope

- Server-side preprocessing of already-uploaded files (would rewrite R2 objects).
- Forking or patching OSMD itself. Not needed for this fix.
- A per-song UI toggle to disable the transform. Add only if a real score is visibly harmed by the splitter.

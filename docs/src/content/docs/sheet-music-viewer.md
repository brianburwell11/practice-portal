---
title: "Sheet Music on Mobile: Working Around iOS Audio Limitations"
description: "Ideas for viewing sheet music PDFs on a phone without interrupting audio playback — the iOS Safari background audio problem and potential solutions."
pubDate: "Apr 11 2026"
tags: ["mobile", "sheet-music", "research", "ios"]
---

## The Problem

Musicians using Practice Portal on a phone want to look at sheet music (PDF) while listening to the multi-stem playback. The obvious approach — link to a Google Drive PDF — doesn't work because:

1. **iOS Universal Links** hijack the URL and open the Google Drive app, leaving the browser entirely
2. **Even if the PDF opens in a new Safari tab**, iOS suspends the AudioContext in the background tab. Audio stops immediately and can't be resumed until the user navigates back.

There's no web API to keep audio playing in a background tab on iOS Safari. This is an OS-level restriction.

## Constraint

The audio and the sheet music must be in the **same tab** for audio to keep playing.

## Ideas

### 1. Embedded PDF viewer panel

Add a toggleable panel in the app that loads a PDF via iframe. The Google Drive `/preview` embed URL renders PDFs directly in the browser without triggering Universal Links:

```
https://drive.google.com/file/d/{fileId}/preview
```

**Pros:**
- Audio keeps playing (same tab)
- No additional infrastructure
- Works with any Google Drive PDF the user has access to

**Cons:**
- Small viewport on a phone — need to toggle between mixer and PDF, or use landscape split
- Google Drive iframe may require sign-in for private files
- Pinch-to-zoom on an iframe is awkward on mobile
- Depends on Google's embed viewer continuing to work

**UX options:**
- Full-screen overlay with a close button (tap to toggle back to mixer)
- Bottom sheet that slides up over the mixer
- Landscape split: transport + mini waveform on top, PDF on bottom
- Collapsible panel like the existing mobile slider toggle

### 2. Inline PDF rendering with pdf.js

Render the PDF natively in a canvas using [pdf.js](https://mozilla.github.io/pdf.js/), giving full control over the viewing experience.

**Pros:**
- Full control over zoom, page navigation, scroll behavior
- No iframe quirks or Google dependency
- Could integrate with playback position (auto-scroll to the right measure)
- Works with any PDF source (R2, local file, Google Drive direct download)

**Cons:**
- Significant implementation effort
- pdf.js bundle is ~500 KB
- Need to handle PDF fetching, page rendering, memory management
- Touch gesture conflicts with the existing waveform controls

### 3. Serve PDFs from R2

Upload sheet music PDFs alongside the audio stems in R2. Link to them directly — no Google Drive Universal Links issue. Open in an iframe within the app.

**Pros:**
- Full control over the file serving
- No third-party auth issues
- Could add to the song config: `sheetMusic: "lead-sheet.pdf"`

**Cons:**
- Need to upload/manage PDFs in the admin flow
- Storage cost (minimal for PDFs)
- Still need an in-app viewer (iframe or pdf.js)

### 4. Image-based sheet music

Convert PDFs to images (PNG/SVG) at upload time and display them in a scrollable `<img>` viewer within the app.

**Pros:**
- Simplest rendering — just images in a scroll container
- No pdf.js dependency
- Could pre-render at upload time via sharp or a cloud function

**Cons:**
- Loss of text selectability (minor for sheet music)
- Large images for multi-page scores
- Need a conversion step in the admin pipeline

### 5. MusicXML rendering (future)

The [musicxml-sheet-music](/docs/musicxml-sheet-music/) research doc explores rendering sheet music from MusicXML sources using libraries like OpenSheetMusicDisplay. This would enable synchronized scrolling with playback position.

**Pros:**
- Tightest integration with the practice tool
- Auto-scroll to current measure during playback
- Could highlight the active beat/note

**Cons:**
- Requires MusicXML sources (not all music is available in this format)
- Significant implementation effort
- Rendering quality varies by library

## Recommendation

**Start with option 1 (embedded Google Drive iframe)** — it's zero infrastructure, works today, and solves the immediate problem. Add a `sheetMusicUrl` field to the song config. When set, show a toggle button in the transport bar that opens the PDF in a full-screen overlay iframe. Audio keeps playing because we never leave the tab.

If the iframe experience is too limiting (zoom issues, auth friction), move to **option 3 + option 2** (serve from R2 + pdf.js) for a fully controlled experience.

Option 5 (MusicXML) is the long-term dream but depends on source material availability.

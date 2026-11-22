---
title: "Sheet Music Editor: Editing a Song's Score in Place"
description: "Fix a song's sheet music in the MuseEncore editor without leaving the site, and save it straight back to the song: no download and no re-upload."
pubDate: "Nov 22 2026"
tags: ["sheet-music", "muse-encore", "editor", "plan"]
---

**Goal:** an editor opens Songs → Sheet Music Editor, fixes notes in [MuseEncore](https://github.com/pstaender/muse-encore)'s score editor, presses Save, and the band sees the change. No download and no re-upload.

## How it works

- **Our own build of the editor.** MuseEncore is already vendored at `vendor/muse-encore` (it draws the sheet music). `score-editor/` is a small Vite app around its `editor/`, built to `dist/score-editor` by `npm run build:score-editor` (part of `npm run build`). In dev, the app's Vite server mounts it at `/score-editor/`.
- **Without MuseScore's submodule.** The upstream editor build reads MuseScore's sources for translations, the soundfont, templates and a few dialog images. `score-editor/vite.config.ts` stubs those: English only, no New Score templates, and the soundfont is fetched from MuseScore's GitHub on the first playback.
- **Same-site iframe.** `src/admin/ScoreEditorPanel.tsx` is a full-screen overlay with Save and Close above an iframe of `/score-editor/?url=<the song's .mscz, or its .mxl>`. The server lets only our own pages frame `/score-editor/` (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`). Every other page still refuses framing.
- **The bridge.** `score-editor/main.tsx` puts `window.scoreEditor` on the editor page (`hasScore`, `isModified`, `saveMscz`, `markSaved`, `onSaveRequest`, `onChange`). The editor's File > Save and Ctrl/Cmd+S call the panel's Save instead of the browser's storage.
- **Saving.** The panel uploads the `.mscz` to `POST /api/r2/mscz-convert-upload/...` under the song's current file name (`uploadMsczForConversion`, shared with Edit Song). The server keeps the `.mscz` and converts it to the `.mxl`. Then the config save sets `sheetMusicMsczUrl` and `sheetMusicModified`. The fresh config brings new `?v=` versions, so the page's sheet music shows the change.

## Steps

- [x] Build the editor as `/score-editor/` (stubs for locales, templates, soundfont; new deps: dexie, spessasynth_lib, TensorFlow.js)
- [x] Mount it on the dev server
- [x] Allow same-site framing of `/score-editor/` only
- [x] Bridge on the editor page; File > Save goes to the song
- [x] `ScoreEditorPanel`: load, save, unsaved-changes prompt
- [x] Songs → Sheet Music Editor (desktop ribbon, `song.score.write`, songs with sheet music)
- [ ] Test on the scratch DB: save a `.mscz` song and a `.mxl`-only song, and check the strip updates
- [ ] Check the editor's `.mscz` converts on the Fly image (MuseScore 4.7.5 CLI)

## Limits

- Desktop only. The editor is built for a mouse and keyboard.
- No New Score: the menu has no templates. A song with no sheet music still gets one through Edit Song.
- The editor keeps its own copies and autosaves in this browser's IndexedDB (`musescoreweb-scores`). Only Save puts the score on the song.
- Play-along needs the microphone, and our `Permissions-Policy` blocks it, so play-along doesn't work in the editor.

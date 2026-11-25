/*
 * SPDX-License-Identifier: GPL-3.0-only
 * The MuseEncore editor (vendor/muse-encore/editor/main.tsx) plus `window.scoreEditor`, which the app's
 * ScoreEditorPanel uses from the parent page (same origin) to save the open score back to the song.
 *
 * The score to open comes from `?url=` (the editor's own startup()). With `?new=1` the editor opens
 * nothing by itself: the panel hands it a score through `openScore` (a song with no sheet music yet).
 */
import { createRoot } from 'react-dom/client'
import '../vendor/muse-encore/editor/style.css'
import './overrides.css'
import { registerAction, triggerAction } from '../vendor/muse-encore/editor/actions/actions'
import { registerAppActions } from '../vendor/muse-encore/editor/actions/appactions'
import { App } from '../vendor/muse-encore/editor/App'
import { initAutoSaver } from '../vendor/muse-encore/editor/autosave'
import { applyLanguageSetting } from '../vendor/muse-encore/editor/i18n'
import { canSave, onSessionChanged, openFileData, session, startup } from '../vendor/muse-encore/editor/session'
import {
  currentMasterScore, currentScore, onScoreViewChanged, scoreChanged, scoreSaved,
} from '../vendor/muse-encore/editor/scoreview'
import { endTextEditing, isModified, markSaved, saveMscz } from '../vendor/muse-encore/src/index'
import { playbackState } from '../vendor/muse-encore/editor/playback/playbackcontroller'
import type { ScoreEditorBridge, SongAudioHost } from '../src/admin/scoreEditorBridge'
import { mountSoundToggle, refreshSoundToggle } from './soundSource'
import { applyPortalLevel } from './audioLevels'
import { toggleAudioLevels } from './audioLevelsMenu'
import { settings, updateSettings } from '../vendor/muse-encore/editor/settings'

let songAudio: SongAudioHost | null = null

const bridge: ScoreEditorBridge = {
  // The playback toolbar offers the recording only while there is one.
  get songAudio() { return songAudio },
  set songAudio(host) {
    songAudio = host ?? null
    refreshSoundToggle()
    applyPortalLevel()
  },
  hasScore: () => !!currentMasterScore(),
  isModified: () => {
    const s = currentMasterScore()
    return !!s && isModified(s)
  },
  loadError: () => session().error ?? null,
  openScore: (name, data) => openFileData(name, data, 'file'),
  saveMscz(fileName) {
    const s = currentMasterScore()
    if (!s) throw new Error('No score is open')
    // A text being edited is ended first, as the editor's own Save does.
    const edited = currentScore()
    if (edited && endTextEditing(edited)) scoreChanged(false)
    return saveMscz(s, fileName)
  },
  markSaved() {
    const s = currentMasterScore()
    if (!s) return
    markSaved(s)
    scoreSaved()
  },
  stopPlayback() {
    if (playbackState().playing) triggerAction('pause')
  },
  togglePlay() {
    triggerAction('play')
  },
}
window.scoreEditor = bridge

// Space plays and pauses, as it does on the song's page: the editor's "Hold Space and drag to move the score"
// (on by default, and then Space has no Play) starts off here. Done once per browser, so turning it back on in
// Preferences sticks.
const SPACE_PLAYS_KEY = 'practice-portal.scoreEditorSpacePlays'
try {
  if (!localStorage.getItem(SPACE_PLAYS_KEY)) {
    if (settings().web.spacePan) updateSettings('web', { spacePan: false })
    localStorage.setItem(SPACE_PLAYS_KEY, '1')
  }
} catch { /* no storage: the editor's default */ }

registerAppActions()
// File > Save and Ctrl/Cmd+S save to the song, not to this browser's storage.
registerAction('file-save', { run: () => bridge.onSaveRequest?.(), enabled: canSave })
// The playback settings menu's first item (added to the menu by score-editor/vite.config.ts).
registerAction('pp-audio-levels', { run: toggleAudioLevels, title: [null, 'Adjust audio settings…'] })

const notify = () => bridge.onChange?.()
onScoreViewChanged(notify)
onSessionChanged(notify)

void applyLanguageSetting()
createRoot(document.getElementById('app-root')!).render(<App />)
mountSoundToggle()
initAutoSaver()
if (!new URLSearchParams(location.search).has('new')) void startup()

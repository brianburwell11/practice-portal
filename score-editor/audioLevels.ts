/*
 * SPDX-License-Identifier: GPL-3.0-only
 * How loud the editor's two sounds are: the song's recording ("Portal Audio", the app's audio engine) and the
 * synthesizer ("Synth Audio", also what plays over the recording in "Portal + Synth"). Set in the playback settings
 * menu's "Adjust audio settings" (AudioLevelsPopup.tsx), kept in this browser.
 *
 * The recording's level goes to the app through `songAudio.setLevel` (the panel scales the page's own volume by it
 * while the editor is open). The synthesizer's is its output gain, which its mute button also sets: SpessaSynthesizer
 * keeps that gain to itself, so it's reached here, and set again whenever mute or loading would reset it.
 */
import type { Synthesizer } from '../vendor/muse-encore/shared/playback/synthesizer'

export interface AudioLevels {
    /** the recording, 0..1 */
    portal: number
    /** the synthesizer, 0..1 */
    synth: number
}

const KEY = 'practice-portal.scoreEditorLevels'

const clamp = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1)

let levels: AudioLevels = (() => {
    try {
        const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AudioLevels>
        return { portal: clamp(s.portal), synth: clamp(s.synth) }
    } catch {
        return { portal: 1, synth: 1 }
    }
})()

const listeners = new Set<() => void>()

export function audioLevels(): AudioLevels {
    return levels
}

export function onAudioLevelsChanged(f: () => void): () => void {
    listeners.add(f)
    return () => listeners.delete(f)
}

export function setAudioLevels(patch: Partial<AudioLevels>): void {
    levels = { ...levels, ...patch }
    try {
        localStorage.setItem(KEY, JSON.stringify(levels))
    } catch { /* this visit only, then */ }
    if ('portal' in patch) {
        applyPortalLevel()
    }
    if ('synth' in patch) {
        applySynthLevel()
    }
    for (const f of listeners) {
        f()
    }
}

/** The recording's level, to the app (when the song has a recording). */
export function applyPortalLevel(): void {
    window.scoreEditor?.songAudio?.setLevel(levels.portal)
}

// ---------------------------------------------------------------------------------
//   the synthesizer's level
// ---------------------------------------------------------------------------------

/** SpessaSynthesizer's own fields (shared/playback/spessasynth.ts): its output gain, its context, its mute */
interface SpessaOutput {
    m_gain?: GainNode | null
    m_context?: AudioContext | null
    m_muted?: boolean
}

let s_synth: Synthesizer | null = null

function applySynthLevel(): void {
    const s = s_synth as unknown as SpessaOutput | null
    if (!s?.m_gain || !s.m_context) {
        return
    }
    s.m_gain.gain.setTargetAtTime(s.m_muted ? 0 : levels.synth, s.m_context.currentTime, 0.01)
}

/** The synthesizer the editor plays: its level follows the setting, through mute and loading. */
export function attachSynth(synth: Synthesizer): void {
    s_synth = synth
    const setMuted = synth.setMuted.bind(synth)
    synth.setMuted = (muted) => {
        setMuted(muted)
        applySynthLevel()
    }
    // The output gain is made while the soundfont loads, at full level.
    const load = synth.load.bind(synth)
    synth.load = (onProgress) => {
        const loading = load(onProgress)
        void loading.then(applySynthLevel, () => {})
        return loading
    }
    applySynthLevel()
}

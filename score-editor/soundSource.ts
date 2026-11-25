/*
 * SPDX-License-Identifier: GPL-3.0-only
 * What the editor's Play plays: the song's recording (songAudioPlayer.ts), the recording with the notation's own
 * sounds over it, in time with it (synthLayer.ts), or the notation's sounds alone. The choice
 * sits in the editor's playback toolbar, after its mute button, as a dropdown styled like the editor's others.
 * The toolbar is the vendor's React code, so the dropdown is added to its DOM from here, and added again whenever the
 * toolbar is drawn anew (docked, floating, or reopened). It shows only when the song has a recording to play
 * (the panel sets `window.scoreEditor.songAudio`).
 */
import { triggerAction } from '../vendor/muse-encore/editor/actions/actions'
import { playbackState } from '../vendor/muse-encore/editor/playback/playbackcontroller'
import type { SongAudioHost } from '../src/admin/scoreEditorBridge'

type Source = 'recording' | 'both' | 'notation'
const SOURCES: readonly Source[] = ['recording', 'both', 'notation']
const KEY = 'practice-portal.scoreEditorSound'
const GROUP_CLASS = 'pp-sound-source'

let source: Source = (() => {
    try {
        const stored = localStorage.getItem(KEY)
        return SOURCES.find((s) => s === stored) ?? 'recording'
    } catch {
        return 'recording'
    }
})()

/** The song's recording, if there is one to play. */
function host(): SongAudioHost | null {
    const h = window.scoreEditor?.songAudio
    return h && h.beatTimes.length >= 2 ? h : null
}

/** Play plays the recording: the song has one and it's chosen (alone, or with the synth over it). */
export function songAudioToPlay(): SongAudioHost | null {
    return source === 'notation' ? null : host()
}

/** The synth plays the notation over the recording, in time with it. */
export function synthOverSong(): boolean {
    return source === 'both' && !!host()
}

function choose(next: Source): void {
    if (next === source) {
        return
    }
    // What's playing stops: the next Play starts the other sound.
    if (playbackState().playing) {
        triggerAction('pause')
    }
    source = next
    try {
        localStorage.setItem(KEY, next)
    } catch { /* this visit only, then */ }
    refreshSoundToggle()
}

const LABELS: Record<Source, string> = {
    recording: 'Portal Audio',
    both: 'Portal + Synth',
    notation: 'Synth Audio',
}

function makeGroup(): HTMLElement {
    const group = document.createElement('span')
    group.className = GROUP_CLASS
    group.style.alignItems = 'center'
    const sep = document.createElement('span')
    sep.className = 'tool-separator'
    const select = document.createElement('select')
    select.className = 'zoom-select'
    select.setAttribute('aria-label', 'Playback sound')
    select.title = 'Portal Audio plays the song’s recording, in time with the sheet music. Portal + Synth plays the '
        + 'notes as written over the recording, following its timing. Synth Audio plays the notes alone.'
    for (const s of SOURCES) {
        select.add(new Option(LABELS[s], s))
    }
    select.addEventListener('change', () => {
        choose(select.value as Source)
        // Back to the score, so the spacebar plays instead of reopening the list.
        select.blur()
    })
    group.append(sep, select)
    return group
}

/** Adds the dropdown after each mute button that hasn't got one, and brings every one up to date. */
export function refreshSoundToggle(): void {
    const show = !!host()
    for (const mute of document.querySelectorAll<HTMLElement>('button[data-action="playback-mute"]')) {
        let group = mute.nextElementSibling as HTMLElement | null
        if (!group?.classList.contains(GROUP_CLASS)) {
            group = makeGroup()
            mute.after(group)
        }
        group.style.display = show ? 'inline-flex' : 'none'
        const select = group.querySelector('select')
        if (select && select.value !== source) {
            select.value = source
        }
    }
}

/** Keeps the dropdown in the toolbar as React redraws it. */
export function mountSoundToggle(): void {
    let queued = false
    new MutationObserver(() => {
        if (queued) {
            return
        }
        queued = true
        requestAnimationFrame(() => {
            queued = false
            refreshSoundToggle()
        })
    }).observe(document.body, { childList: true, subtree: true })
    refreshSoundToggle()
}

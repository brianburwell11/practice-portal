/*
 * SPDX-License-Identifier: GPL-3.0-only
 * "Adjust audio settings" (the playback settings menu, opened by audioLevelsMenu.tsx): two sliders, the recording ("Portal Audio") and the
 * synthesizer ("Synth Audio"), in a popup under the toolbar's sound dropdown. Styled as the editor's Speed popup
 * (PlaybackToolBar.tsx SpeedPopup, `.speed-popup`).
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { audioLevels, onAudioLevelsChanged, setAudioLevels, type AudioLevels } from './audioLevels'

/** What the popup sits under: the sound dropdown when it shows, else the settings button it was opened from. */
function anchorElement(): HTMLElement | null {
    const sound = document.querySelector<HTMLElement>('.pp-sound-source')
    if (sound && sound.offsetParent !== null) {
        return sound
    }
    return document.querySelector<HTMLElement>('[data-action="playback-settings"]')
}

function LevelRow({ id, label, value, disabled, hint, onChange }: {
    id: string
    label: string
    value: number
    disabled?: boolean
    hint?: string
    onChange: (v: number) => void
}): React.JSX.Element {
    const percent = Math.round(value * 100)
    return (
        <>
            <label className="speed-label" htmlFor={id}>{label}</label>
            <span className="number-with-unit" aria-hidden="true">{disabled ? '' : `${percent} %`}</span>
            <input id={id} type="range" min={0} max={1} step={0.01} value={value} disabled={disabled}
                aria-valuetext={`${percent} %`} title={hint}
                onChange={(e) => onChange(Number(e.target.value))} />
        </>
    )
}

export function AudioLevelsPopup({ onClose }: { onClose: () => void }): React.JSX.Element {
    const levels = useSyncExternalStore<AudioLevels>(onAudioLevelsChanged, audioLevels)
    const hasRecording = !!window.scoreEditor?.songAudio
    const ref = useRef<HTMLDivElement>(null)

    // Placed under the anchor once it can be measured, then the first slider takes the focus.
    useLayoutEffect(() => {
        const el = ref.current
        const a = anchorElement()?.getBoundingClientRect()
        if (!el) {
            return
        }
        if (a) {
            const w = el.offsetWidth
            el.style.left = `${Math.max(8, Math.min(a.left + a.width / 2 - w / 2, window.innerWidth - w - 8))}px`
            el.style.top = `${a.bottom + 4}px`
        }
        el.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
    }, [])

    useEffect(() => {
        const onDown = (e: PointerEvent): void => {
            if (!ref.current?.contains(e.target as Node)) {
                onClose()
            }
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
    }, [onClose])

    return (
        <div ref={ref} className="speed-popup" role="dialog" aria-label="Audio settings" tabIndex={-1}
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation()
                    onClose()
                }
            }}>
            <LevelRow id="pp-level-portal" label="Portal Audio" value={levels.portal} disabled={!hasRecording}
                hint={hasRecording ? undefined : 'This song has no beat map to play its recording in time with the score.'}
                onChange={(portal) => setAudioLevels({ portal })} />
            <LevelRow id="pp-level-synth" label="Synth Audio" value={levels.synth}
                onChange={(synth) => setAudioLevels({ synth })} />
        </div>
    )
}

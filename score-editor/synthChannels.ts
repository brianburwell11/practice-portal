/*
 * SPDX-License-Identifier: GPL-3.0-only
 * The editor's synth channels, kept within the synthesizer's first 16.
 *
 * The editor numbers synth channels by instrument channel and voice (notationplayback.ts: instrument channel × 4 +
 * voice), so a score's fifth instrument sound (a third horn after two with open and mute sounds) is already channel
 * 16. SpessaSynthesizer adds channels past 16 when asked, but the ones it adds stay silent, so those parts played
 * nothing. Here the editor's channel numbers are mapped onto the synthesizer's 16 as they're first used: a score with
 * up to 16 sounds in use (each voice of each instrument sound counts once) plays them all. Past that, the channel
 * used least recently is handed over, its notes stopped first.
 *
 * Every caller goes through it (the player, the synth over the recording, the count-in, the notes heard while
 * editing), since it wraps the synthesizer object they all share.
 */
import type { SynthChannelSetup, Synthesizer } from '../vendor/muse-encore/shared/playback/synthesizer'

const PHYSICAL = 16
/** MIDI "all notes off" */
const CC_ALL_NOTES_OFF = 123

export function keepChannelsWithin16(synth: Synthesizer): void {
    /** the editor's channel -> the synthesizer's */
    const map = new Map<number, number>()
    /** the synthesizer's channel -> the editor's channel it plays now */
    const owner: (number | null)[] = new Array(PHYSICAL).fill(null)
    const lastUsed: number[] = new Array(PHYSICAL).fill(0)
    let clock = 0

    const controller = synth.controller.bind(synth)

    const physical = (channel: number): number => {
        let p = map.get(channel)
        if (p === undefined) {
            p = owner.indexOf(null)
            if (p < 0) {
                // All 16 in use: the one used least recently, its notes ended first.
                p = lastUsed.indexOf(Math.min(...lastUsed))
                map.delete(owner[p]!)
                controller(p, CC_ALL_NOTES_OFF, 0)
            }
            owner[p] = channel
            map.set(channel, p)
        }
        lastUsed[p] = ++clock
        return p
    }

    const setupChannel = synth.setupChannel.bind(synth)
    synth.setupChannel = (channel: number, setup: SynthChannelSetup, time?: number) => setupChannel(physical(channel), setup, time)
    const noteOn = synth.noteOn.bind(synth)
    synth.noteOn = (channel: number, pitch: number, velocity: number, time?: number) => noteOn(physical(channel), pitch, velocity, time)
    const noteOff = synth.noteOff.bind(synth)
    synth.noteOff = (channel: number, pitch: number, time?: number) => noteOff(physical(channel), pitch, time)
    synth.controller = (channel: number, cc: number, value: number, time?: number) => controller(physical(channel), cc, value, time)
    const programChange = synth.programChange.bind(synth)
    synth.programChange = (channel: number, program: number, time?: number) => programChange(physical(channel), program, time)
    const pitchBend = synth.pitchBend.bind(synth)
    synth.pitchBend = (channel: number, value: number, time?: number) => pitchBend(physical(channel), value, time)
}

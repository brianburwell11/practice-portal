/*
 * SPDX-License-Identifier: GPL-3.0-only
 * "Portal + Synth": the notation played on the editor's synthesizer over the song's recording, in time with it.
 *
 * The score's events are retimed onto the recording (score seconds -> played measure and fraction -> tapped beat ->
 * audio seconds, the same mapping as songAudioPlayer.ts), and a timer follows the position the app's audio engine
 * reports as heard, scheduling each event a short time ahead on the synthesizer's clock. Following the engine
 * rather than a clock of its own keeps the notes on the recording through the tapMap's tempo changes, the
 * transport's Speed, seeks, and the recording's loop: a jump in the engine's position starts the notes again from
 * there. The sending and the "chasing" of controllers follow the vendor's Player
 * (vendor/muse-encore/shared/playback/player.ts).
 */
import type { PlayerEvent } from '../vendor/muse-encore/shared/playback/player'
import type { SynthChannelSetup, Synthesizer } from '../vendor/muse-encore/shared/playback/synthesizer'
import { currentScore } from '../vendor/muse-encore/editor/scoreview'
import { notationPlayback } from '../vendor/muse-encore/src/index'
import type { SongAudioHost } from '../src/admin/scoreEditorBridge'
import { audioAt, playedMeasures } from './songTiming'

/** MuseScore's program change controller (as in the vendor's Player) */
const CTRL_PROGRAM = 0x81
/** how far ahead of the heard position events are scheduled, on top of the synthesizer's output latency (seconds) */
const LOOKAHEAD = 0.06
const TIMER_MS = 15
/** a move of the engine's position this far beyond what the timer explains is a seek or a loop (seconds of audio) */
const JUMP = 0.25

/** An event at its time in the recording. */
interface TimedEvent {
    t: number
    e: PlayerEvent
}

/** What the layer reads from the editor's own Player: the metronome switch and the muted parts. */
export interface LayerSettings {
    readonly metronomeEnabled: boolean
    readonly mutedChannels: Set<number>
}

export class SynthLayer {
    private m_events: PlayerEvent[] = []
    private m_setups = new Map<number, SynthChannelSetup>()
    /** the events retimed onto the recording, and what they were retimed from */
    private m_timed: TimedEvent[] = []
    private m_timedKey: { events: PlayerEvent[]; beats: readonly number[][]; score: unknown } | null = null

    private m_host: SongAudioHost | null = null
    private m_timer = 0
    /** the engine position at the last tick (audio seconds); null: start again from the next one */
    private m_lastPos: number | null = null
    private m_next = 0
    private m_active = new Map<string, { channel: number; pitch: number }>()

    private m_synth: Synthesizer
    private m_settings: LayerSettings
    /** the soundfont is loaded (the synthesizer's own isLoaded: the editor's Player reports it loaded sooner) */
    private m_ready: () => boolean

    constructor(synth: Synthesizer, settings: LayerSettings, ready: () => boolean) {
        this.m_synth = synth
        this.m_settings = settings
        this.m_ready = ready
    }

    running(): boolean { return !!this.m_host }

    setEvents(events: PlayerEvent[], setups: Map<number, SynthChannelSetup>): void {
        this.m_events = events
        this.m_setups = setups
        if (this.m_host) {
            // The score changed while playing: its sounds again, and the notes from where the recording is.
            this.silence()
            this.m_lastPos = null
        }
    }

    /** Plays along with `host` until stop(); waits while the engine is starting. */
    start(host: SongAudioHost): void {
        this.stop()
        this.m_host = host
        this.m_lastPos = null
        this.m_timer = window.setInterval(() => this.tick(), TIMER_MS)
    }

    stop(): void {
        if (!this.m_host) {
            return
        }
        this.m_host = null
        clearInterval(this.m_timer)
        this.m_timer = 0
        this.silence()
    }

    // ---------------------------------------------------------------------------------

    private tick(): void {
        const host = this.m_host
        if (!host || !host.isPlaying()) {
            return
        }
        if (!this.m_ready()) {
            // Still loading the soundfont: the notes join in where the recording is once it's there.
            this.m_lastPos = null
            return
        }
        const timed = this.timed(host)
        const synth = this.m_synth
        const pos = host.position()
        const rate = Math.max(0.05, host.rate())
        const now = synth.currentTime()
        const latency = synth.outputLatency()

        const last = this.m_lastPos
        if (last === null || pos < last - 0.05 || pos > last + JUMP) {
            this.restartAt(timed, pos, now)
        }
        this.m_lastPos = pos

        const until = pos + (LOOKAHEAD + latency) * rate
        while (this.m_next < timed.length && timed[this.m_next].t < until) {
            const { t, e } = timed[this.m_next++]
            this.send(e, Math.max(now, now + (t - pos) / rate - latency))
        }
    }

    /** Notes from `pos` on: the ones sounding end, the channels' sounds are set, and the controllers before it sent. */
    private restartAt(timed: TimedEvent[], pos: number, now: number): void {
        for (const n of this.m_active.values()) {
            this.m_synth.noteOff(n.channel, n.pitch, now)
        }
        this.m_active.clear()
        this.setupChannels()
        let lo = 0
        let hi = timed.length
        while (lo < hi) {
            const mid = (lo + hi) >> 1
            if (timed[mid].t < pos) {
                lo = mid + 1
            } else {
                hi = mid
            }
        }
        this.m_next = lo
        const chased = new Map<string, PlayerEvent>()
        for (let i = 0; i < lo; ++i) {
            const e = timed[i].e
            if (e.type === 'cc') {
                chased.set(`${e.channel}:cc${e.a}`, e)
            } else if (e.type === 'pb') {
                chased.set(`${e.channel}:pb`, e)
            }
        }
        for (const e of chased.values()) {
            this.send(e, now)
        }
    }

    private send(e: PlayerEvent, time: number): void {
        const synth = this.m_synth
        switch (e.type) {
        case 'on':
            if ((e.metronome && !this.m_settings.metronomeEnabled) || this.m_settings.mutedChannels.has(e.channel)) {
                return
            }
            synth.noteOn(e.channel, e.a, e.b, time)
            this.m_active.set(`${e.channel}:${e.a}`, { channel: e.channel, pitch: e.a })
            break
        case 'off':
            synth.noteOff(e.channel, e.a, time)
            this.m_active.delete(`${e.channel}:${e.a}`)
            break
        case 'cc':
            if (e.a === CTRL_PROGRAM) {
                synth.programChange(e.channel, e.b, time)
            } else {
                synth.controller(e.channel, e.a, e.b, time)
            }
            break
        case 'pb':
            synth.pitchBend(e.channel, e.a, time)
            break
        }
    }

    private setupChannels(): void {
        const now = this.m_synth.currentTime()
        for (const [channel, setup] of this.m_setups) {
            this.m_synth.setupChannel(channel, setup, now)
        }
    }

    /** Ends every sound now, as the vendor's Player does on a stop. */
    private silence(): void {
        const synth = this.m_synth
        for (const n of this.m_active.values()) {
            synth.noteOff(n.channel, n.pitch)
        }
        this.m_active.clear()
        synth.stopAll(true)
        for (const channel of this.m_setups.keys()) {
            synth.controller(channel, 64, 0) // sustain off
            synth.pitchBend(channel, 8192)
        }
    }

    /** The events at their times in the recording, retimed when the events, the tapMap or the score changed. */
    private timed(host: SongAudioHost): TimedEvent[] {
        const score = currentScore()
        const key = this.m_timedKey
        if (key && key.events === this.m_events && key.beats === host.beatTimes && key.score === score) {
            return this.m_timed
        }
        this.m_timedKey = { events: this.m_events, beats: host.beatTimes, score }
        this.m_timed = score ? retime(this.m_events, host.beatTimes, notationPlayback(score)) : []
        this.m_lastPos = null
        return this.m_timed
    }
}

/** score seconds -> audio seconds for every event; events past the last tapped measure are left out. */
function retime(
    events: readonly PlayerEvent[],
    beats: readonly number[][],
    playback: { secToPlayedTick(secs: number): number },
): TimedEvent[] {
    const measures = playedMeasures()
    const count = Math.min(measures.length, beats.length)
    if (count === 0) {
        return []
    }
    const out: TimedEvent[] = []
    let i = 0
    for (const e of events) {
        const utick = playback.secToPlayedTick(e.time)
        // The events come in time order, so the measure only moves forwards (but look back in case they don't).
        while (i > 0 && measures[i].ustart > utick) {
            i--
        }
        while (i + 1 < measures.length && measures[i + 1].ustart <= utick) {
            i++
        }
        if (i >= count) {
            continue
        }
        const m = measures[i]
        const fraction = Math.max(0, Math.min(1, (utick - m.ustart) / Math.max(1, m.ulen)))
        out.push({ t: audioAt(beats, i, fraction), e })
    }
    // Stable: a note off at the same time as the next note on keeps its place before it.
    out.sort((a, b) => a.t - b.t)
    return out
}

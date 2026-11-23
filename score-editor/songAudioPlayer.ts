/*
 * SPDX-License-Identifier: GPL-3.0-only
 * The editor's Player (vendor/muse-encore/shared/playback/player.ts), with the song's own recording in place of
 * the synthesized notation. The editor's playback controller imports this instead of the vendor's Player (see
 * `editorStubs` in vite.config.ts), so the toolbar's play, pause, rewind, loop and click-to-seek, the spacebar and
 * the moving cursor all drive the app's audio engine, through `window.scoreEditor.songAudio` (scoreEditorBridge).
 *
 * The editor works in seconds at the score's written tempo; the recording follows the song's tapMap. Positions
 * go through the played measure (the repeat list's order, repeats unfolded, as the tapMap counts measures) and
 * the beat inside it:
 *   score seconds -> played tick -> played measure and fraction -> tapped beat -> audio seconds
 * and back the same way.
 *
 * With no song audio (no host, a tapMap of fewer than two measures, or the toolbar set to "Notation"), every call
 * goes to the vendor's Player and the editor sounds as it always did. Notes heard while editing always use the
 * synthesizer.
 */
import { Player as SynthPlayer, type PlayerEvent } from '../vendor/muse-encore/shared/playback/player'
import type { SynthChannelSetup, Synthesizer } from '../vendor/muse-encore/shared/playback/synthesizer'
import { currentScore } from '../vendor/muse-encore/editor/scoreview'
import { notationPlayback } from '../vendor/muse-encore/src/index'
import type { SongAudioHost } from '../src/admin/scoreEditorBridge'
import { songAudioToPlay } from './soundSource'

export type { PlayerEvent }

/** A measure as played: where it starts in the unrolled score, and its length, in ticks. */
interface PlayedMeasure {
    ustart: number
    ulen: number
}

const songAudio = songAudioToPlay

/** The open score's measures in the order they're played (repeats unfolded if the editor plays them). */
function playedMeasures(): PlayedMeasure[] {
    const score = currentScore()
    if (!score) {
        return []
    }
    const playback = notationPlayback(score)
    const out: PlayedMeasure[] = []
    for (const seg of score.masterScore().repeatList(playback.playRepeats)) {
        for (const m of seg.measureList()) {
            out.push({ ustart: seg.utick + (m.tick().ticks() - seg.tick), ulen: m.ticks().ticks() })
        }
    }
    return out
}

/** Where a played measure ends in audio: the next downbeat, or for the last one, a beat past its last beat. */
function measureEnd(beatTimes: readonly number[][], i: number): number {
    const next = beatTimes[i + 1]?.[0]
    if (next !== undefined) {
        return next
    }
    const beats = beatTimes[i]
    const n = beats.length
    return n > 1 ? beats[n - 1] + (beats[n - 1] - beats[0]) / (n - 1) : beats[0] + 1
}

/** Audio seconds at `fraction` (0..1) through played measure `i`, by its tapped beats. */
function audioAt(beatTimes: readonly number[][], i: number, fraction: number): number {
    const beats = beatTimes[i]
    const n = beats.length
    const b = Math.max(0, Math.min(n, fraction * n))
    const k = Math.min(n - 1, Math.floor(b))
    const t0 = beats[k]
    const t1 = beats[k + 1] ?? measureEnd(beatTimes, i)
    return t0 + (b - k) * (t1 - t0)
}

/** The played measure at audio `seconds` and how far through it (0..1), by its tapped beats. */
function measureAt(beatTimes: readonly number[][], seconds: number): { i: number; fraction: number } {
    if (seconds <= beatTimes[0][0]) {
        return { i: 0, fraction: 0 }
    }
    let lo = 0
    let hi = beatTimes.length - 1
    if (seconds >= beatTimes[hi][0]) {
        lo = hi
    } else {
        while (lo + 1 < hi) {
            const mid = (lo + hi) >>> 1
            if (beatTimes[mid][0] <= seconds) {
                lo = mid
            } else {
                hi = mid
            }
        }
    }
    const beats = beatTimes[lo]
    const n = beats.length
    const end = measureEnd(beatTimes, lo)
    if (seconds >= end) {
        return { i: lo + 1, fraction: 0 }
    }
    let k = 0
    while (k + 1 < n && beats[k + 1] <= seconds) {
        k++
    }
    const t1 = beats[k + 1] ?? end
    const b = k + (seconds - beats[k]) / Math.max(0.001, t1 - beats[k])
    return { i: lo, fraction: b / n }
}

export class Player {
    private m_real: SynthPlayer
    /** the song audio while it is playing (or about to), else null */
    private m_host: SongAudioHost | null = null
    /** the score position where the song audio started; reported until the engine is actually playing */
    private m_startPos = 0
    /** the engine hasn't confirmed it's playing yet (count-in delay, or its play() still resolving) */
    private m_starting = false
    private m_startTimer = 0

    onEnded: (() => void) | null = null

    constructor(synth: Synthesizer) {
        this.m_real = new SynthPlayer(synth)
        this.m_real.onEnded = () => this.onEnded?.()
        // Playing the song doesn't need the soundfont (tens of MB, fetched on first use). Report it as loaded so
        // the controller doesn't wait for it, and fetch it in the background for the notes heard while editing,
        // which are silent until it lands (the synthesizer ignores notes before then).
        const isLoaded = synth.isLoaded.bind(synth)
        synth.isLoaded = () => {
            if (isLoaded() || !songAudio()) {
                return isLoaded()
            }
            void synth.load().catch(() => {})
            return true
        }
    }

    get metronomeEnabled(): boolean { return this.m_real.metronomeEnabled }
    set metronomeEnabled(on: boolean) { this.m_real.metronomeEnabled = on }
    get mutedChannels(): Set<number> { return this.m_real.mutedChannels }
    set mutedChannels(channels: Set<number>) { this.m_real.mutedChannels = channels }

    synth(): Synthesizer { return this.m_real.synth() }

    setEvents(events: PlayerEvent[], duration: number, setups: Map<number, SynthChannelSetup>): void {
        this.m_real.setEvents(events, duration, setups)
    }

    duration(): number { return this.m_real.duration() }

    setDuration(duration: number): void { this.m_real.setDuration(duration) }

    isPlaying(): boolean {
        const host = this.m_host
        if (!host) {
            return this.m_real.isPlaying()
        }
        if (this.m_starting) {
            return true
        }
        // The engine stopped by itself (the end of the recording), or the audio is past the score's end.
        if (!host.isPlaying() || this.songPosition(host) >= this.duration()) {
            this.endSong(true)
            return false
        }
        return true
    }

    position(): number {
        const host = this.m_host
        if (!host) {
            return this.m_real.position()
        }
        return this.m_starting ? this.m_startPos : Math.min(this.songPosition(host), this.duration())
    }

    play(delay = 0): void {
        if (this.m_host || this.m_real.isPlaying()) {
            return
        }
        const host = songAudio()
        if (!host || playedMeasures().length === 0) {
            this.m_real.play(delay)
            return
        }
        this.m_host = host
        this.m_startPos = this.m_real.position()
        this.m_starting = true
        this.applyLoop(host)
        host.seek(this.toAudio(host, this.m_startPos))
        const start = () => {
            this.m_startTimer = 0
            if (this.m_host !== host) {
                return
            }
            void host.play().finally(() => {
                if (this.m_host === host) {
                    this.m_starting = false
                }
            })
        }
        // The count-in clicks (from the synthesizer) play first.
        if (delay > 0) {
            this.m_startTimer = window.setTimeout(start, delay * 1000)
        } else {
            start()
        }
    }

    pause(): void {
        if (this.m_host) {
            this.endSong(false)
        } else {
            this.m_real.pause()
        }
    }

    stop(): void {
        this.pause()
    }

    seek(pos: number): void {
        this.m_real.seek(pos)
        const host = this.m_host
        if (host) {
            this.m_startPos = this.m_real.position()
            host.seek(this.toAudio(host, this.m_startPos))
        }
    }

    setLoop(from: number, to: number): void {
        this.m_real.setLoop(from, to)
        if (this.m_host) {
            this.applyLoop(this.m_host)
        }
    }

    resetLoop(): void {
        this.m_real.resetLoop()
        this.m_host?.clearLoop()
    }

    loop(): { from: number; to: number } | null { return this.m_real.loop() }

    // ---------------------------------------------------------------------------------

    private songPosition(host: SongAudioHost): number {
        return this.toScore(host, host.position())
    }

    /** Stops the song audio and keeps its position for the next play. */
    private endSong(ended: boolean): void {
        const host = this.m_host
        if (!host) {
            return
        }
        const pos = this.position()
        clearTimeout(this.m_startTimer)
        this.m_startTimer = 0
        this.m_host = null
        this.m_starting = false
        if (host.isPlaying()) {
            host.pause()
        }
        this.m_real.seek(pos)
        if (ended) {
            this.onEnded?.()
        }
    }

    private applyLoop(host: SongAudioHost): void {
        const loop = this.m_real.loop()
        if (loop) {
            host.setLoop(this.toAudio(host, loop.from), this.toAudio(host, loop.to))
        } else {
            host.clearLoop()
        }
    }

    /** score seconds -> audio seconds */
    private toAudio(host: SongAudioHost, secs: number): number {
        const score = currentScore()
        const measures = playedMeasures()
        if (!score || measures.length === 0) {
            return 0
        }
        const utick = notationPlayback(score).secToPlayedTick(secs)
        let i = measures.length - 1
        while (i > 0 && measures[i].ustart > utick) {
            i--
        }
        const m = measures[i]
        const fraction = Math.max(0, Math.min(1, (utick - m.ustart) / Math.max(1, m.ulen)))
        const beats = host.beatTimes
        if (i >= beats.length) {
            // The score goes on past the tapped measures: the end of the last one.
            return measureEnd(beats, beats.length - 1)
        }
        return audioAt(beats, i, fraction)
    }

    /** audio seconds -> score seconds */
    private toScore(host: SongAudioHost, audioSecs: number): number {
        const score = currentScore()
        const measures = playedMeasures()
        if (!score || measures.length === 0) {
            return 0
        }
        const { i, fraction } = measureAt(host.beatTimes, audioSecs)
        if (i >= measures.length) {
            // Past the score's last measure: its end, which stops the playback.
            return this.duration()
        }
        const m = measures[i]
        return notationPlayback(score).playedTickToSec(m.ustart + fraction * m.ulen)
    }
}

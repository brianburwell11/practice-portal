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
 * With no song audio (no host, a tapMap of fewer than two measures, or the toolbar set to "Synth Audio"), every call
 * goes to the vendor's Player and the editor sounds as it always did. Set to "Portal + Synth", the synthesizer also
 * plays the notation over the recording (synthLayer.ts). Notes heard while editing always use the synthesizer.
 */
import { Player as SynthPlayer, type PlayerEvent } from '../vendor/muse-encore/shared/playback/player'
import type { SynthChannelSetup, Synthesizer } from '../vendor/muse-encore/shared/playback/synthesizer'
import { currentScore } from '../vendor/muse-encore/editor/scoreview'
import { notationPlayback } from '../vendor/muse-encore/src/index'
import type { SongAudioHost } from '../src/admin/scoreEditorBridge'
import { songAudioToPlay, synthOverSong } from './soundSource'
import { measureAt, measureEnd, audioAt, playedMeasures } from './songTiming'
import { SynthLayer } from './synthLayer'
import { attachSynth } from './audioLevels'
import { keepChannelsWithin16 } from './synthChannels'

export type { PlayerEvent }

const songAudio = songAudioToPlay

export class Player {
    private m_real: SynthPlayer
    /** the song audio while it is playing (or about to), else null */
    private m_host: SongAudioHost | null = null
    /** the score position where the song audio started; reported until the engine is actually playing */
    private m_startPos = 0
    /** the engine hasn't confirmed it's playing yet (count-in delay, or its play() still resolving) */
    private m_starting = false
    private m_startTimer = 0
    /** the synthesizer over the recording ("Portal + Synth") */
    private m_layer: SynthLayer
    /** the synthesizer's own isLoaded (the soundfont is there), before the override below */
    private m_soundsLoaded: () => boolean
    /** the synthesizer alone waits for the soundfont before it starts (see loadSounds) */
    private m_waitingForSounds = false

    onEnded: (() => void) | null = null

    constructor(synth: Synthesizer) {
        // Before anything plays: a score's channels past 16 would be silent (synthChannels.ts).
        keepChannelsWithin16(synth)
        attachSynth(synth)
        this.m_real = new SynthPlayer(synth)
        this.m_real.onEnded = () => this.onEnded?.()
        const isLoaded = synth.isLoaded.bind(synth)
        this.m_soundsLoaded = isLoaded
        this.m_layer = new SynthLayer(synth, this.m_real, isLoaded)
        // Playing the song doesn't need the soundfont (tens of MB, fetched on first use). Report it as loaded so
        // the controller doesn't wait for it, and fetch it in the background for the notes heard while editing,
        // which are silent until it lands (the synthesizer ignores notes before then).
        synth.isLoaded = () => {
            // Over the recording the synthesizer is heard, so Play waits for the soundfont as it does alone.
            if (isLoaded() || !songAudio() || synthOverSong()) {
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
        this.m_layer.setEvents(events, setups)
    }

    duration(): number { return this.m_real.duration() }

    setDuration(duration: number): void { this.m_real.setDuration(duration) }

    isPlaying(): boolean {
        const host = this.m_host
        if (!host) {
            return this.m_waitingForSounds || this.m_real.isPlaying()
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
        if (this.m_host || this.m_waitingForSounds || this.m_real.isPlaying()) {
            return
        }
        const host = songAudio()
        if (!host || playedMeasures().length === 0) {
            if (this.m_soundsLoaded()) {
                this.m_real.play(delay)
                return
            }
            // The channels' sounds are set as it starts, so it starts once they can be.
            this.m_waitingForSounds = true
            void this.m_real.synth().load().then(() => {
                if (this.m_waitingForSounds) {
                    this.m_waitingForSounds = false
                    this.m_real.play(0)
                }
            }, () => {
                this.m_waitingForSounds = false
                this.onEnded?.()
            })
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
            // The synthesizer follows the recording from when it starts.
            if (synthOverSong()) {
                this.loadSounds()
                this.m_layer.start(host)
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
        this.m_waitingForSounds = false
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

    /**
     * Starts loading the soundfont when the synthesizer is about to be heard over the recording without it. The
     * editor's Play loads it first, but its resume (Play after a click on the score moved the playhead) doesn't.
     */
    private loadSounds(): void {
        if (!this.m_soundsLoaded()) {
            void this.m_real.synth().load().catch(() => {})
        }
    }

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
        this.m_layer.stop()
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

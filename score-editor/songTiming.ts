/*
 * SPDX-License-Identifier: GPL-3.0-only
 * The editor's score time against the song's recording: the played measures of the open score (repeats unfolded as
 * the tapMap counts them) and the recording's tapped beats. Used by the song audio player (songAudioPlayer.ts) and the
 * synth played over the recording (synthLayer.ts).
 */
import { currentScore } from '../vendor/muse-encore/editor/scoreview'
import { notationPlayback } from '../vendor/muse-encore/src/index'

/** A measure as played: where it starts in the unrolled score, and its length, in ticks. */
export interface PlayedMeasure {
    ustart: number
    ulen: number
}

/** The open score's measures in the order they're played (repeats unfolded if the editor plays them). */
export function playedMeasures(): PlayedMeasure[] {
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
export function measureEnd(beatTimes: readonly number[][], i: number): number {
    const next = beatTimes[i + 1]?.[0]
    if (next !== undefined) {
        return next
    }
    const beats = beatTimes[i]
    const n = beats.length
    return n > 1 ? beats[n - 1] + (beats[n - 1] - beats[0]) / (n - 1) : beats[0] + 1
}

/** Audio seconds at `fraction` (0..1) through played measure `i`, by its tapped beats. */
export function audioAt(beatTimes: readonly number[][], i: number, fraction: number): number {
    const beats = beatTimes[i]
    const n = beats.length
    const b = Math.max(0, Math.min(n, fraction * n))
    const k = Math.min(n - 1, Math.floor(b))
    const t0 = beats[k]
    const t1 = beats[k + 1] ?? measureEnd(beatTimes, i)
    return t0 + (b - k) * (t1 - t0)
}

/** The played measure at audio `seconds` and how far through it (0..1), by its tapped beats. */
export function measureAt(beatTimes: readonly number[][], seconds: number): { i: number; fraction: number } {
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

/**
 * ffmpeg / ffprobe helpers: probing, loudness measurement, and Opus
 * transcoding. Runs the binaries on PATH — the container in Phase 3 has to
 * ship them — asynchronously and without a shell (see `run.ts`).
 *
 * Normalizing a stem is a plain gain toward TARGET_LUFS, not `loudnorm`.
 * loudnorm's "linear" mode quietly turned into dynamic compression for most
 * real stems (it only stays linear when the gain fits under the peak ceiling
 * and the loudness range is small), squashing drums, and it ran twice at
 * 192 kHz. Now: one ebur128 pass to measure, then in the encode
 *   - a gate, only on stems with a clear noise bed well below the playing,
 *     that holds the background back by as much as the stem is turned up;
 *   - the gain, allowed to push peaks at most MAX_LIMITING_DB past the ceiling;
 *   - a peak limiter, only when that happens, to catch those peaks.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './run';

export const TARGET_LUFS = -16;
/** Where true peaks should end up, in dBTP. */
const PEAK_CEILING_DB = -1.5;
/** At most this much of the loudest peaks is limited to reach the target. */
const MAX_LIMITING_DB = 6;
/**
 * The limiter's sample-peak ceiling. Lower than PEAK_CEILING_DB: true peaks
 * between samples, and Opus, land a little above it.
 */
const LIMITER_DB = -2.5;
/** Gate only when the noise floor is at least this far below the stem's loudness. */
const GATE_MIN_SEPARATION_DB = 25;
/** The gate opens this far above the noise floor... */
const GATE_ABOVE_FLOOR_DB = 10;
/** ...and never higher than this far below the stem's loudness. */
const GATE_BELOW_LOUDNESS_DB = 15;
/** The most the gate holds the background back. */
const MAX_GATE_RANGE_DB = 24;
/** Short-term loudness at or below this is digital silence (gaps between regions), not noise. */
const SILENCE_LUFS = -100;
/** EBU R128's absolute gate: integrated loudness this low means nothing to measure. */
const NOTHING_LUFS = -70;

export interface ProbeResult {
  codec: string;
  bitrate: number;
  channels: number;
  sampleRate: number;
  /** Seconds; 0 when ffprobe can't tell. */
  duration: number;
}

/** Called with 0–1 as ffmpeg works through the file. */
export type OnProgress = (fraction: number) => void;

/**
 * ffmpeg's `-progress pipe:1` output, turned into 0–1 calls. Lines arrive as
 * `key=value`; `out_time_us` is how far into the input it is.
 */
function progressArgs(duration: number, onProgress?: OnProgress): { args: string[]; onStdout?: (chunk: string) => void } {
  if (!onProgress || duration <= 0) return { args: [] };
  let partial = '';
  return {
    args: ['-progress', 'pipe:1'],
    onStdout: (chunk) => {
      const lines = (partial + chunk).split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines) {
        const m = line.match(/^out_time_us=(\d+)/);
        if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration));
      }
    },
  };
}

export interface LoudnessInfo {
  /** Integrated loudness, LUFS (EBU R128). */
  integrated: number;
  /** True peak, dBTP. */
  truePeak: number;
  /**
   * The background level: the 10th percentile of short-term (400 ms)
   * loudness over the parts that aren't digital silence. Null when there's
   * too little to tell.
   */
  noiseFloor: number | null;
}

/** The subset of `ffprobe -show_streams` output we care about. */
interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  bit_rate?: string;
  channels?: number;
  sample_rate?: string;
}

export async function ffprobe(filePath: string): Promise<ProbeResult> {
  const proc = await run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath]);
  if (proc.code !== 0) throw new Error('Couldn’t read this file as audio — is it a WAV, FLAC, AIFF or MP3?');
  const data = JSON.parse(proc.stdout) as { streams?: FfprobeStream[]; format?: { duration?: string } };
  const audio = data.streams?.find((s) => s.codec_type === 'audio');
  if (!audio) throw new Error('This file has no audio in it');
  return {
    codec: audio.codec_name ?? '',
    bitrate: parseInt(audio.bit_rate ?? '0', 10),
    channels: audio.channels ?? 0,
    sampleRate: parseInt(audio.sample_rate ?? '0', 10),
    duration: parseFloat(data.format?.duration ?? '0') || 0,
  };
}

const parseDb = (v: string | undefined) => (v === undefined ? NaN : v.includes('inf') ? -Infinity : parseFloat(v));

/** Measure loudness, true peak and the noise floor in one pass. */
export async function measureLoudness(filePath: string, duration = 0, onProgress?: OnProgress): Promise<LoudnessInfo> {
  const progress = progressArgs(duration, onProgress);
  // Short-term loudness every 100 ms goes to a file: too much for stderr.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-loudness-'));
  const log = path.join(dir, 'm.txt');
  try {
    const proc = await run('ffmpeg', [
      '-nostats', ...progress.args, '-i', filePath,
      '-af', `ebur128=peak=true:metadata=1:framelog=quiet,ametadata=print:key=lavfi.r128.M:file=${log}`,
      '-f', 'null', '-',
    ], { onStdout: progress.onStdout });
    if (proc.code !== 0) throw new Error(`loudness measurement failed: ${proc.stderr.slice(-500)}`);

    const summary = proc.stderr.slice(proc.stderr.lastIndexOf('Summary:'));
    const integrated = parseDb(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
    const truePeak = parseDb(summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/)?.[1]);
    if (Number.isNaN(integrated) || Number.isNaN(truePeak)) throw new Error('Could not read loudness from ffmpeg output');

    const levels = fs.readFileSync(log, 'utf8').split('\n')
      .filter((l) => l.startsWith('lavfi.r128.M='))
      .map((l) => parseDb(l.slice('lavfi.r128.M='.length)))
      .filter((v) => v > SILENCE_LUFS)
      .sort((a, b) => a - b);
    const noiseFloor = levels.length >= 20 ? levels[Math.floor(levels.length * 0.1)] : null;
    return { integrated, truePeak, noiseFloor };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface NormalizePlan {
  gainDb: number;
  /** A limiter catches the peaks the gain pushes over the ceiling. */
  limit: boolean;
  /** A gate holding the background back, when there's a clear noise bed. */
  gate: { thresholdDb: number; rangeDb: number } | null;
}

/** What normalizing a stem with this loudness does. */
export function planNormalize(l: LoudnessInfo): NormalizePlan {
  // Silence, or too quiet to measure: leave it alone.
  if (!Number.isFinite(l.integrated) || l.integrated <= NOTHING_LUFS || !Number.isFinite(l.truePeak)) {
    return { gainDb: 0, limit: false, gate: null };
  }
  const gainDb = Math.min(TARGET_LUFS - l.integrated, PEAK_CEILING_DB - l.truePeak + MAX_LIMITING_DB);
  const limit = l.truePeak + gainDb > PEAK_CEILING_DB;
  let gate: NormalizePlan['gate'] = null;
  if (gainDb > 1 && l.noiseFloor !== null && l.integrated - l.noiseFloor >= GATE_MIN_SEPARATION_DB) {
    gate = {
      thresholdDb: Math.min(l.noiseFloor + GATE_ABOVE_FLOOR_DB, l.integrated - GATE_BELOW_LOUDNESS_DB),
      rangeDb: Math.min(gainDb, MAX_GATE_RANGE_DB),
    };
  }
  return { gainDb, limit, gate };
}

const linear = (db: number) => (10 ** (db / 20)).toFixed(6);

/** The ffmpeg audio filters for a plan, in order. */
export function normalizeFilters(plan: NormalizePlan): string[] {
  const filters: string[] = [];
  if (plan.gate) {
    // A soft downward expander, released slowly so decays fade instead of chopping.
    filters.push(`agate=threshold=${linear(plan.gate.thresholdDb)}:range=${linear(-plan.gate.rangeDb)}:ratio=4:attack=10:release=300`);
  }
  if (Math.abs(plan.gainDb) >= 0.05) filters.push(`volume=${plan.gainDb.toFixed(2)}dB`);
  if (plan.limit) filters.push(`alimiter=limit=${linear(LIMITER_DB)}:attack=1:release=50:level=false`);
  return filters;
}

/**
 * Transcode to Opus, normalized with the measured loudness when `normalize`
 * is on. Without a measurement (it failed), the level is left as it is.
 */
export async function transcodeToOpus(
  inputPath: string,
  outputPath: string,
  probe: ProbeResult,
  loudness: LoudnessInfo | undefined,
  normalize: boolean,
  onProgress?: OnProgress,
): Promise<void> {
  const isMono = probe.channels === 1;
  const bitrate = isMono ? '64k' : '128k';

  const filters = normalize && loudness ? normalizeFilters(planNormalize(loudness)) : [];
  const filter = filters.length ? ['-af', filters.join(',')] : [];

  const progress = progressArgs(probe.duration, onProgress);
  const proc = await run('ffmpeg', [
    '-nostats', ...progress.args, '-y', '-i', inputPath, ...filter,
    '-codec:a', 'libopus', '-b:a', bitrate, ...(isMono ? ['-ac', '1'] : []), '-ar', '48000', '-vbr', 'on',
    outputPath,
  ], { onStdout: progress.onStdout });
  if (proc.code !== 0) throw new Error(`Opus transcode failed: ${proc.stderr.slice(-500)}`);
}

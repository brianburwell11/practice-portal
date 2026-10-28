/**
 * ffmpeg / ffprobe helpers: probing, two-pass `loudnorm` measurement, and
 * Opus transcoding. Runs the binaries on PATH — the container in Phase 3 has
 * to ship them — asynchronously and without a shell (see `run.ts`).
 */
import { run } from './run';

export const TARGET_LUFS = -16;

export interface ProbeResult {
  codec: string;
  bitrate: number;
  channels: number;
  sampleRate: number;
}

export interface LoudnessInfo {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
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
  const proc = await run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath]);
  if (proc.code !== 0) throw new Error(`ffprobe failed (exit ${proc.code})`);
  const data = JSON.parse(proc.stdout) as { streams?: FfprobeStream[] };
  const audio = data.streams?.find((s) => s.codec_type === 'audio');
  if (!audio) throw new Error('No audio stream found');
  return {
    codec: audio.codec_name ?? '',
    bitrate: parseInt(audio.bit_rate ?? '0', 10),
    channels: audio.channels ?? 0,
    sampleRate: parseInt(audio.sample_rate ?? '0', 10),
  };
}

/** Pass 1 of two-pass loudnorm: measure, don't write. */
export async function measureLoudness(filePath: string): Promise<LoudnessInfo> {
  const proc = await run('ffmpeg', [
    '-nostats', '-i', filePath,
    '-af', `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json`,
    '-f', 'null', '-',
  ]);

  if (proc.code !== 0) {
    throw new Error(`loudnorm measurement failed: ${proc.stderr?.slice(-500)}`);
  }

  const jsonMatch = proc.stderr.match(/\{[^{}]*"input_i"\s*:[^{}]*\}/s);
  if (!jsonMatch) {
    throw new Error('Could not parse loudnorm JSON from ffmpeg output');
  }
  return JSON.parse(jsonMatch[0]) as LoudnessInfo;
}

/** Pass 2: transcode to Opus, optionally applying the measured loudnorm. */
export async function transcodeToOpus(
  inputPath: string,
  outputPath: string,
  probe: ProbeResult,
  loudness: LoudnessInfo | undefined,
  normalize: boolean,
): Promise<void> {
  const isMono = probe.channels === 1;
  const bitrate = isMono ? '64k' : '128k';

  let filter: string[];
  if (!normalize) {
    filter = [];
  } else if (loudness && parseFloat(loudness.input_i) <= 0) {
    filter = ['-af', `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:measured_I=${loudness.input_i}:measured_TP=${loudness.input_tp}:measured_LRA=${loudness.input_lra}:measured_thresh=${loudness.input_thresh}:offset=${loudness.target_offset}:linear=true`];
  } else {
    filter = ['-af', `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`];
  }

  const proc = await run('ffmpeg', [
    '-nostats', '-y', '-i', inputPath, ...filter,
    '-codec:a', 'libopus', '-b:a', bitrate, ...(isMono ? ['-ac', '1'] : []), '-ar', '48000', '-vbr', 'on',
    outputPath,
  ]);
  if (proc.code !== 0) throw new Error(`Opus transcode failed: ${proc.stderr.slice(-500)}`);
}

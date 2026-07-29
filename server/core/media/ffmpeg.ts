/**
 * ffmpeg / ffprobe helpers: probing, two-pass `loudnorm` measurement, and
 * Opus transcoding. Shells out to the binaries on PATH — the container in
 * Phase 3 has to ship them.
 */
import { execSync, spawnSync } from 'node:child_process';

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

export function ffprobe(filePath: string): ProbeResult {
  const raw = execSync(
    `ffprobe -v quiet -print_format json -show_streams "${filePath}"`,
    { encoding: 'utf-8' },
  );
  const data = JSON.parse(raw) as { streams?: FfprobeStream[] };
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
export function measureLoudness(filePath: string): LoudnessInfo {
  const proc = spawnSync('ffmpeg', [
    '-i', filePath,
    '-af', `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json`,
    '-f', 'null', '-',
  ], { encoding: 'utf-8' });

  if (proc.status !== 0) {
    throw new Error(`loudnorm measurement failed: ${proc.stderr?.slice(-500)}`);
  }

  const jsonMatch = proc.stderr.match(/\{[^{}]*"input_i"\s*:[^{}]*\}/s);
  if (!jsonMatch) {
    throw new Error('Could not parse loudnorm JSON from ffmpeg output');
  }
  return JSON.parse(jsonMatch[0]) as LoudnessInfo;
}

/** Pass 2: transcode to Opus, optionally applying the measured loudnorm. */
export function transcodeToOpus(
  inputPath: string,
  outputPath: string,
  probe: ProbeResult,
  loudness: LoudnessInfo | undefined,
  normalize: boolean,
): void {
  const isMono = probe.channels === 1;
  const bitrate = isMono ? '64k' : '128k';
  const channelFlag = isMono ? '-ac 1' : '';

  let filterFlag: string;
  if (!normalize) {
    filterFlag = '';
  } else if (loudness && parseFloat(loudness.input_i) <= 0) {
    filterFlag = `-af loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:measured_I=${loudness.input_i}:measured_TP=${loudness.input_tp}:measured_LRA=${loudness.input_lra}:measured_thresh=${loudness.input_thresh}:offset=${loudness.target_offset}:linear=true`;
  } else {
    filterFlag = `-af loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`;
  }

  execSync(
    `ffmpeg -y -i "${inputPath}" ${filterFlag} -codec:a libopus -b:a ${bitrate} ${channelFlag} -ar 48000 -vbr on "${outputPath}"`,
    { stdio: 'ignore' },
  );
}

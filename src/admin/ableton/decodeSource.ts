/**
 * Decode an Ableton project's source audio into an AudioBuffer.
 *
 * AIFF is parsed in the audio worker (see aiff.ts), so big files don't
 * stall the page. Everything else goes through decodeAudioData, which
 * decodes off the main thread on its own.
 */
import { AIFF_EXTENSIONS, isAbletonProtected } from './aiff';
import { pcmToAudioBuffer } from './pcm';
import { callAudioWorker } from './workerClient';

export async function decodeSource(file: File, sampleRate: number): Promise<AudioBuffer> {
  if (await isAbletonProtected(file)) {
    throw new Error(`${file.name} is Ableton Pack audio, which Ableton encrypts`);
  }
  if (AIFF_EXTENSIONS.test(file.name)) {
    // The worker reads and parses the file itself.
    const parsed = await callAudioWorker('parseAiff', [file]);
    if (parsed) return pcmToAudioBuffer(parsed);
  }
  const bytes = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(2, 1, sampleRate);
  try {
    return await ctx.decodeAudioData(bytes);
  } catch {
    throw new Error(`Could not decode ${file.name}`);
  }
}

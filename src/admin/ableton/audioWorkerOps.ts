/**
 * The import worker's operations: everything CPU-heavy in an Ableton
 * import, so the page stays responsive while it runs. That's reading the
 * set, AIFF parsing, time-stretching, group mixing and WAV encoding. The
 * page does only what needs Web Audio (decodeAudioData and the
 * OfflineAudioContext render), and both of those run off the main thread
 * on their own.
 */
import { DOMParser } from '@xmldom/xmldom';
import type { AbletonSet } from './alsParser';
import { gunzipAls, parseAlsDocument } from './alsParser';
import type { Pcm } from './pcm';
import { parseAiffPcm } from './aiff';
import { stretchPcm } from './stretch';
import { GroupMixer } from './groupMix';
import type { FinishedPcm } from './finishPcm';
import { finishPcm } from './finishPcm';
import { encodeWavChannels } from '../utils/audioConvert';

const mixers = new Map<number, GroupMixer>();

export const audioWorkerOps = {
  /** Workers have no DOMParser, so the set's XML is read with xmldom. */
  async parseAls(file: File): Promise<AbletonSet> {
    const xml = await gunzipAls(await file.arrayBuffer());
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return parseAlsDocument(doc as unknown as Document);
  },

  async parseAiff(file: File): Promise<Pcm | null> {
    return parseAiffPcm(await file.arrayBuffer());
  },

  stretch(input: Pcm, preFrames: number, rate: number, outLength: number): Pcm {
    return stretchPcm(input, preFrames, rate, outLength);
  },

  finish(pcm: Pcm): FinishedPcm {
    return finishPcm(pcm);
  },

  mixStart(id: number, length: number, sampleRate: number): void {
    mixers.set(id, new GroupMixer(length, sampleRate));
  },

  mixAdd(id: number, track: Pcm, gain: number, pan: number): void {
    const mixer = mixers.get(id);
    if (!mixer) throw new Error(`No group mix ${id}`);
    mixer.add(track, gain, pan);
  },

  mixFinish(id: number): FinishedPcm & { limitedSamples: number } {
    const mixer = mixers.get(id);
    if (!mixer) throw new Error(`No group mix ${id}`);
    mixers.delete(id);
    const mixed = mixer.finish();
    return {
      pcm: mixed.pcm,
      wav: encodeWavChannels(mixed.pcm.channels, mixed.pcm.sampleRate),
      headroomGain: mixed.headroomGain,
      limitedSamples: mixed.limitedSamples,
    };
  },

  mixCancel(id: number): void {
    mixers.delete(id);
  },
};

export type AudioWorkerOps = typeof audioWorkerOps;

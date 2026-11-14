/// <reference lib="webworker" />
/**
 * Encodes one stem to FLAC off the page's main thread. One worker per file;
 * see `compressStem` in flacClient.ts.
 */
import { encodeFileToFlac } from './encodeFile';

export type FlacWorkerMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; blob: Blob | null }
  | { type: 'error'; message: string };

const post = (m: FlacWorkerMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<{ file: File }>) => {
  try {
    let last = 0;
    const blob = await encodeFileToFlac(e.data.file, (fraction) => {
      if (fraction - last >= 0.02 || fraction === 1) {
        last = fraction;
        post({ type: 'progress', fraction });
      }
    });
    post({ type: 'done', blob });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

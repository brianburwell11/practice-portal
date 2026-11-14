/**
 * Shrinks a WAV or AIFF stem to FLAC before it's uploaded. FLAC is lossless:
 * the server decodes it to exactly the samples in the original, so the Opus
 * it makes is the same either way (see flacEncoder.test.ts). Only the upload
 * gets smaller, usually to about half.
 */
import type { FlacWorkerMessage } from './flac.worker';

/** Not worth it unless the FLAC is at least this much smaller. */
const MIN_SAVING = 0.1;
const ENCODABLE = /\.(wav|wave|aiff?|aifc)$/i;

/**
 * The file to upload: a FLAC when that's meaningfully smaller, otherwise
 * null (upload the original). Never rejects: any trouble means "upload the
 * original".
 */
export async function compressStem(file: File, onProgress?: (fraction: number) => void): Promise<Blob | null> {
  if (!ENCODABLE.test(file.name) || typeof Worker === 'undefined') return null;
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./flac.worker.ts', import.meta.url), { type: 'module' });
    const w = worker;
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<FlacWorkerMessage>) => {
        const m = e.data;
        if (m.type === 'progress') onProgress?.(m.fraction);
        else if (m.type === 'done') resolve(m.blob);
        else reject(new Error(m.message));
      };
      w.onerror = (e) => reject(new Error(e.message || 'FLAC worker failed'));
      w.postMessage({ file });
    });
    if (!blob || blob.size > file.size * (1 - MIN_SAVING)) return null;
    return blob;
  } catch (err) {
    console.warn(`[flac] couldn't compress ${file.name}, uploading it as is:`, err);
    return null;
  } finally {
    worker?.terminate();
  }
}

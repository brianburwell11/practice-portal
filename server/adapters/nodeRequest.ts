/**
 * Node `IncomingMessage` body reading, shared by every Node-hosted adapter
 * (the Vite dev middleware today, the standalone server in Phase 3).
 *
 * Uploads are streamed to a scratch directory rather than buffered, because
 * raw stems are routinely hundreds of megabytes. The caller owns the returned
 * directory and must remove it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import Busboy from 'busboy';
import type { UploadedFile } from '../core/types';

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

export interface MultipartLimits {
  files?: number;
  fileSize?: number;
}

/**
 * Stream a multipart body into `tmpDir`. Filenames are reduced to their
 * basename so a client can't escape the directory.
 */
export function readMultipart(
  req: IncomingMessage,
  tmpDir: string,
  limits: MultipartLimits = {},
): Promise<UploadedFile[]> {
  return new Promise((resolve, reject) => {
    const files: UploadedFile[] = [];
    const writes: Promise<void>[] = [];
    let sizeExceeded = false;

    const busboy = Busboy({
      headers: req.headers as Record<string, string>,
      ...(limits.files || limits.fileSize ? { limits } : {}),
    });

    busboy.on('file', (fieldName, stream, info) => {
      const filename = path.basename(info.filename || 'upload');
      const filePath = path.join(tmpDir, filename);
      const ws = fs.createWriteStream(filePath);
      stream.on('limit', () => { sizeExceeded = true; });
      stream.pipe(ws);
      writes.push(new Promise<void>((res, rej) => {
        ws.on('finish', () => {
          files.push({ fieldName, filename, path: filePath });
          res();
        });
        ws.on('error', rej);
      }));
    });

    busboy.on('finish', () => {
      if (sizeExceeded) {
        reject(new Error(`Upload exceeds ${limits.fileSize} bytes`));
        return;
      }
      Promise.all(writes).then(() => resolve(files)).catch(reject);
    });
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

/** Create a scratch directory for one request's uploads and intermediates. */
export function makeScratchDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeScratchDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

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
import { HttpError } from '../core/http';
import type { UploadedFile } from '../core/types';

/** Read a request body as text, refusing one larger than `maxBytes` (413). */
export function readBody(req: IncomingMessage, maxBytes = Infinity): Promise<string> {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new HttpError(413, `Request body is larger than ${Math.round(maxBytes / 1024)} KB`);
    if (Number(req.headers['content-length'] ?? 0) > maxBytes) {
      req.resume(); // drain it, so the response still goes out
      reject(tooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return; // keep draining, without keeping it
      size += chunk.length;
      if (size > maxBytes) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => (over ? reject(tooLarge()) : resolve(Buffer.concat(chunks).toString())));
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
    let tooManyFiles = false;

    const busboy = Busboy({
      headers: req.headers as Record<string, string>,
      // No form fields are used; files only.
      limits: { ...limits, fields: 0, parts: (limits.files ?? 1) },
    });
    busboy.on('filesLimit', () => { tooManyFiles = true; });

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
        reject(new HttpError(413, `Upload is larger than ${Math.round((limits.fileSize ?? 0) / (1024 * 1024))} MB`));
        return;
      }
      if (tooManyFiles) {
        reject(new HttpError(413, `Upload has more than ${limits.files} file(s)`));
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

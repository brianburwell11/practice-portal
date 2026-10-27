/**
 * Serves the built SPA (`vite build` output) with a client-side routing
 * fallback, so a deep link like `/my-band/admin/...` loads `index.html` and
 * React Router takes it from there.
 *
 * Media never comes through here — audio, scores and JSON configs are read
 * straight from the R2 public URL by the browser. This is ~2 MB of HTML, JS
 * and CSS, so files are read per request and only the gzip output is cached.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map']);

/** Vite fingerprints everything under `assets/`, so it never changes in place. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Everything else (index.html, public/ files) must revalidate on each load. */
const REVALIDATE = 'no-cache';

interface Resolved {
  filePath: string;
  stat: fs.Stats;
}

function resolveFile(root: string, pathname: string): Resolved | null {
  const filePath = path.join(root, pathname);
  // path.join normalizes `..`; anything that still lands outside root is refused.
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null;
  try {
    let stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const index = path.join(filePath, 'index.html');
      stat = fs.statSync(index);
      return { filePath: index, stat };
    }
    return stat.isFile() ? { filePath, stat } : null;
  } catch {
    return null;
  }
}

/** A path whose last segment has an extension is a file request, not a route. */
function looksLikeFile(pathname: string): boolean {
  return path.extname(pathname) !== '';
}

const gzipCache = new Map<string, Buffer>();

function gzipped(filePath: string, stat: fs.Stats): Buffer {
  const key = `${filePath}:${stat.mtimeMs}:${stat.size}`;
  let buf = gzipCache.get(key);
  if (!buf) {
    buf = zlib.gzipSync(fs.readFileSync(filePath));
    gzipCache.set(key, buf);
  }
  return buf;
}

function send(req: IncomingMessage, res: ServerResponse, root: string, file: Resolved): void {
  const { filePath, stat } = file;
  const ext = path.extname(filePath).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const rel = path.relative(root, filePath).split(path.sep).join('/');

  res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', rel.startsWith('assets/') ? IMMUTABLE : REVALIDATE);
  res.setHeader('ETag', etag);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.end();
    return;
  }

  let body: Buffer = fs.readFileSync(filePath);
  if (COMPRESSIBLE.has(ext) && body.length > 1024) {
    res.setHeader('Vary', 'Accept-Encoding');
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      body = gzipped(filePath, stat);
      res.setHeader('Content-Encoding', 'gzip');
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Length', body.length);
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function createStaticHandler(root: string) {
  const absRoot = path.resolve(root);
  const indexHtml = path.join(absRoot, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    throw new Error(`No SPA build at ${indexHtml} — run \`npm run build\` first`);
  }

  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end();
      return;
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      res.statusCode = 400;
      res.end();
      return;
    }

    const file = resolveFile(absRoot, pathname);
    if (file) return send(req, res, absRoot, file);

    // A missing script or stylesheet must 404 — answering with index.html
    // would hand the browser HTML where it expects JS.
    if (looksLikeFile(pathname)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
      return;
    }

    send(req, res, absRoot, { filePath: indexHtml, stat: fs.statSync(indexHtml) });
  };
}

import { dataUrl } from './url';

/**
 * Document revisions: which version of a song's config, lyrics or chords, or
 * a setlist, this tab last read or saved. A save sends it as `?baseRev=`, and
 * the server refuses (409) a save based on an older copy, so two editors
 * can't silently overwrite each other.
 *
 * Keys are the data layout's (`<band>/songs/<song>/lyrics.json`). Reads from
 * R2 directly (the GitHub Pages build) carry no revision, and saves then go
 * ahead unchecked, as they always have.
 */
const revs = new Map<string, number>();

/** Documents that have a revision on the server. */
function hasRev(key: string): boolean {
  return /\/songs\/[^/]+\/(config|lyrics|chords)\.json$/.test(key) || /\/setlists\/(?!index\.json$)[^/]+\.json$/.test(key);
}

/** The revision this tab knows for `key`, if any. */
export function knownRev(key: string): number | undefined {
  return revs.get(key);
}

/** Forget what's known about `key` (a song renamed, a setlist deleted). */
export function forgetRev(key: string): void {
  revs.delete(key);
}

/**
 * `fetch(dataUrl(key))`, noting the document's revision. A missing lyrics or
 * chords file from the server is revision 0: a save from here then only goes
 * through if nobody created one meanwhile.
 */
export async function fetchDoc(key: string, init?: RequestInit): Promise<Response> {
  const url = dataUrl(key);
  const res = await fetch(url, init);
  if (hasRev(key)) {
    const header = res.headers.get('X-Doc-Rev');
    if (header !== null && Number.isInteger(Number(header))) revs.set(key, Number(header));
    else if (res.status === 404 && url.startsWith('/api/data/')) revs.set(key, 0);
  }
  return res;
}

/** A save refused because the document changed since this tab read it. */
export class DocConflictError extends Error {
  /** The document as the server has it now (null if it's gone). */
  current: unknown;
  /** Its revision now (0 if it's gone). */
  rev: number;

  constructor(current: unknown, rev: number) {
    super('Someone else saved a change since you opened this. Reload to see the latest, then make your change again.');
    this.name = 'DocConflictError';
    this.current = current;
    this.rev = rev;
  }
}

/**
 * Save a document: POST `body` to `url` (the write route for `key`), based on
 * the revision this tab knows. Throws `DocConflictError` on a 409, or an
 * `Error` with the server's message on any other failure. Returns the new
 * revision, which later saves are based on.
 */
export async function saveDoc(key: string, url: string, body: unknown, method = 'POST'): Promise<number | undefined> {
  const base = revs.get(key);
  const target = base === undefined ? url : `${url}${url.includes('?') ? '&' : '?'}baseRev=${base}`;
  const res = await fetch(target, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({})) as { error?: string; rev?: number | null; current?: unknown };
  if (res.status === 409 && 'current' in json) {
    throw new DocConflictError(json.current ?? null, json.rev ?? 0);
  }
  if (!res.ok) throw new Error(json.error ?? `Save failed: ${res.status}`);
  if (typeof json.rev === 'number') revs.set(key, json.rev);
  return json.rev ?? undefined;
}

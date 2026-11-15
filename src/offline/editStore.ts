/**
 * Edits saved on this device and not yet on the server, in IndexedDB
 * ("pp-edits"), so they survive a reload or a closed tab. One record per
 * document per account: saving the same document again replaces the waiting
 * copy and keeps what it was based on.
 *
 * Each edit belongs to the account that made it, and is only shown to or sent
 * by that account (`sync.ts`). On a shared device, someone else signing in
 * later never sends it as theirs.
 */
import type { MergeKind } from './merge';

export interface PendingEdit {
  /** `editId(userId, key)`: one waiting copy per document per account. */
  id: string;
  /** The account that made it (null: nobody signed in, which the server refuses anyway). */
  userId: string | null;
  /** Its name, for "waiting for Alex to sign in". */
  userName: string;
  /** The document (`<band>/songs/<song>/lyrics.json`). */
  key: string;
  /** Where it's saved (`/api/bands/<band>/songs/<song>/lyrics`). */
  url: string;
  /** For people: "Chasing Sleep lyrics". */
  label: string;
  band: string;
  kind: MergeKind;
  /** The edit. */
  data: unknown;
  /** The server's copy it started from (null: there wasn't one; undefined: not known). */
  base: unknown;
  /** That copy's revision. */
  baseRev: number | undefined;
  state: 'pending' | 'conflict';
  /** The server's copy when it turned out someone else had changed it. */
  conflict?: { current: unknown; rev: number };
  /** When it was last saved here. A newer save while one is sending isn't lost. */
  savedAt: number;
}

const DB_NAME = 'pp-edits';
const DOCS = 'docs';

export const editId = (userId: string | null, key: string) => `${userId ?? 'anonymous'}|${key}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Version 2: edits are per account, keyed by `id`. Version 1 (never
      // released) didn't record who made them, so its records can't be kept.
      if (db.objectStoreNames.contains(DOCS)) db.deleteObjectStore(DOCS);
      db.createObjectStore(DOCS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withDocs<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | undefined): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(DOCS, mode);
      const req = fn(tx.objectStore(DOCS));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const supported = () => typeof indexedDB !== 'undefined';

export async function allEdits(): Promise<PendingEdit[]> {
  if (!supported()) return [];
  return (await withDocs<PendingEdit[]>('readonly', (s) => s.getAll())) ?? [];
}

export async function getEdit(id: string): Promise<PendingEdit | undefined> {
  if (!supported()) return undefined;
  return withDocs<PendingEdit>('readonly', (s) => s.get(id));
}

export async function putEdit(edit: PendingEdit): Promise<void> {
  await withDocs('readwrite', (s) => s.put(edit));
}

export async function deleteEdit(id: string): Promise<void> {
  await withDocs('readwrite', (s) => s.delete(id));
}

export async function clearEdits(): Promise<void> {
  if (!supported()) return;
  await withDocs('readwrite', (s) => s.clear());
}

/**
 * A new save of a document, folded into the one already waiting: the new
 * data, but the same base (what the server had when editing started), and a
 * conflict stays a conflict.
 */
export function coalesce(existing: PendingEdit | undefined, incoming: PendingEdit): PendingEdit {
  if (!existing || existing.id !== incoming.id) return incoming;
  return { ...existing, data: incoming.data, url: incoming.url, label: incoming.label, savedAt: incoming.savedAt };
}

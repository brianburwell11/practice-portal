/**
 * Calls into the audio worker from the page. Arguments and results move
 * between threads by transfer, so sample arrays passed in are handed over
 * (and emptied on this side): pass copies of anything still needed.
 */
import type { AudioWorkerOps } from './audioWorkerOps';
import { findTransferables } from './transfer';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./audioWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error !== undefined) p.reject(new Error(e.data.error));
    else p.resolve(e.data.result);
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'Audio worker failed');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker = null;
  };
  return worker;
}

export function callAudioWorker<K extends keyof AudioWorkerOps>(
  op: K,
  args: Parameters<AudioWorkerOps[K]>,
): Promise<Awaited<ReturnType<AudioWorkerOps[K]>>> {
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, op, args }, findTransferables(args));
  });
}

/** A unique id for a group mix held in the worker. */
export function newMixId(): number {
  return nextId++;
}

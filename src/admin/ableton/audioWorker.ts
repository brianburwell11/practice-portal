/// <reference lib="webworker" />
/**
 * Web Worker that runs the Ableton import's heavy audio processing off the
 * page's main thread. See audioWorkerOps.ts for the operations and
 * workerClient.ts for how the page calls them.
 */
import { audioWorkerOps } from './audioWorkerOps';
import { findTransferables } from './transfer';

type Op = keyof typeof audioWorkerOps;

self.onmessage = async (e: MessageEvent<{ id: number; op: Op; args: unknown[] }>) => {
  const { id, op, args } = e.data;
  try {
    const fn = audioWorkerOps[op] as (...a: unknown[]) => unknown;
    const result = await fn(...args);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, result }, findTransferables(result));
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};

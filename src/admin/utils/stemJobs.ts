/**
 * Stems through the server's job queue (Phase 9): each raw file goes
 * straight to storage with a presigned PUT and is queued the moment it's
 * there, so the server transcodes the first stems while the rest are still
 * uploading. This polls until each is done or failed. Nothing here holds a
 * long request open, so a big song can't time out.
 *
 * Uploads are the slow part (raw WAVs over a home connection), and a dropped
 * connection can leave one hanging. Each file gets a few tries; one that
 * still fails is marked `failed` with Retry beside it, instead of the whole
 * batch waiting forever.
 */
import { uploadFileWithProgress } from './uploadWithProgress';

export interface StemJobState {
  stemId: string;
  filename: string;
  jobId: string;
  /** uploading → waiting (queued) → transcoding → done | failed */
  phase: 'uploading' | 'waiting' | 'transcoding' | 'done' | 'failed';
  /** 0–1 within the phase: bytes sent while uploading, the server's progress while transcoding. */
  progress: number;
  error: string | null;
}

interface JobView {
  id: string;
  status: 'uploading' | 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  error: string | null;
}

const POLL_MS = 1000;
/** Files uploading at once. */
const UPLOAD_CONCURRENCY = 4;
/** Tries per file, counting the first. */
const UPLOAD_ATTEMPTS = 3;

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const songUrl = (bandId: string, songId: string) =>
  `/api/bands/${encodeURIComponent(bandId)}/songs/${encodeURIComponent(songId)}/stems`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PUT with a few tries, a little longer apart each time. */
async function putWithRetries(
  url: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      onProgress(0);
      await uploadFileWithProgress(url, file, contentType, (sent, total) => onProgress(total ? sent / total : 0));
      return;
    } catch (err) {
      if (attempt >= UPLOAD_ATTEMPTS) throw err;
      await sleep(2000 * attempt);
    }
  }
}

/** Upload one file, then hand it to the worker. */
async function uploadAndQueue(
  base: string,
  jobId: string,
  uploadUrl: string,
  contentType: string,
  file: File,
  set: (patch: Partial<StemJobState>) => void,
): Promise<void> {
  try {
    set({ phase: 'uploading', progress: 0, error: null });
    await putWithRetries(uploadUrl, file, contentType, (progress) => set({ progress }));
    set({ phase: 'waiting', progress: 0 });
    await api('POST', `${base}/queue`, { jobIds: [jobId] });
  } catch (err) {
    set({ phase: 'failed', progress: 0, error: (err as Error).message });
  }
}

/** Merge the server's view of each job into the local states. */
function applyJobs(states: StemJobState[], jobs: JobView[]): StemJobState[] {
  return states.map((s) => {
    const j = jobs.find((x) => x.id === s.jobId);
    if (!j) return s;
    // Uploads are tracked here, not on the server: a stem still `uploading`
    // there is either in flight (local progress is better) or failed locally.
    if (j.status === 'uploading') return s;
    const phase = j.status === 'running' ? 'transcoding' : j.status === 'queued' ? 'waiting' : j.status;
    return { ...s, phase, progress: j.progress, error: j.error };
  });
}

/**
 * Upload every stem, queueing each as it lands. Resolves once every upload
 * has finished or failed, with the states and the song's audio address;
 * follow with `waitForStems`. Never rejects over one file: a stem that
 * couldn't upload comes back `failed`.
 */
export async function uploadStems(
  bandId: string,
  songId: string,
  stems: { stemId: string; file: File }[],
  normalize: boolean,
  onUpdate: (states: StemJobState[]) => void,
): Promise<{ states: StemJobState[]; publicBase: string }> {
  const base = songUrl(bandId, songId);
  const { jobs, publicBase } = await api<{ jobs: { id: string; stemId: string; contentType: string; uploadUrl: string }[]; publicBase: string }>(
    'POST', base, {
      normalize,
      files: stems.map(({ stemId, file }) => ({ stemId, filename: file.name, size: file.size })),
    },
  );
  let states: StemJobState[] = jobs.map((j) => ({
    stemId: j.stemId,
    filename: stems.find((s) => s.stemId === j.stemId)!.file.name,
    jobId: j.id,
    phase: 'uploading',
    progress: 0,
    error: null,
  }));
  const set = (jobId: string) => (patch: Partial<StemJobState>) => {
    states = states.map((s) => (s.jobId === jobId ? { ...s, ...patch } : s));
    onUpdate(states);
  };
  onUpdate(states);

  // While uploads run, show how the queued ones are getting on.
  let uploading = true;
  const ids = jobs.map((j) => j.id).join(',');
  const poll = (async () => {
    while (uploading) {
      await sleep(POLL_MS * 2);
      if (!uploading || !states.some((s) => s.phase === 'waiting' || s.phase === 'transcoding')) continue;
      try {
        const { jobs: views } = await api<{ jobs: JobView[] }>('GET', `${base}?jobs=${ids}`);
        if (!uploading) break;
        states = applyJobs(states, views);
        onUpdate(states);
      } catch { /* the next poll, or waitForStems, catches up */ }
    }
  })();

  const queue = [...jobs];
  const worker = async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      const { file } = stems.find((s) => s.stemId === j!.stemId)!;
      await uploadAndQueue(base, j.id, j.uploadUrl, j.contentType, file, set(j.id));
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, jobs.length) }, worker));
  uploading = false;
  await poll;

  return { states, publicBase };
}

/** Poll until every stem is done or failed. Resolves with the final states. */
export async function waitForStems(
  bandId: string,
  songId: string,
  initial: StemJobState[],
  onUpdate: (states: StemJobState[]) => void,
): Promise<StemJobState[]> {
  let states = initial;
  const ids = states.map((s) => s.jobId).join(',');
  for (;;) {
    if (states.every((s) => s.phase === 'done' || s.phase === 'failed')) {
      onUpdate(states);
      return states;
    }
    const { jobs } = await api<{ jobs: JobView[] }>('GET', `${songUrl(bandId, songId)}?jobs=${ids}`);
    states = applyJobs(states, jobs);
    onUpdate(states);
    if (states.every((s) => s.phase === 'done' || s.phase === 'failed')) return states;
    await sleep(POLL_MS);
  }
}

/**
 * Try a failed stem again. If its transcode failed, it goes back in the
 * queue; if its upload never finished, the file is uploaded again first.
 * Returns the stem's new state.
 */
export async function retryStem(
  bandId: string,
  songId: string,
  stem: StemJobState,
  file: File | undefined,
  onUpdate: (stem: StemJobState) => void,
): Promise<StemJobState> {
  const base = songUrl(bandId, songId);
  let current: StemJobState = { ...stem, phase: 'waiting', progress: 0, error: null };
  const set = (patch: Partial<StemJobState>) => {
    current = { ...current, ...patch };
    onUpdate(current);
  };
  onUpdate(current);
  const res = await api<{ uploadUrl?: string; contentType?: string }>(
    'POST', `${base}/${stem.jobId}/retry`, file ? { size: file.size } : undefined,
  );
  if (res.uploadUrl && res.contentType) {
    if (!file) throw new Error(`Add ${stem.filename} again to retry it`);
    await uploadAndQueue(base, stem.jobId, res.uploadUrl, res.contentType, file, set);
  }
  return current;
}

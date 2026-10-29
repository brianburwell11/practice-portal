/**
 * Stems through the server's job queue (Phase 9): each raw file goes
 * straight to storage with a presigned PUT, the server transcodes them one at
 * a time in the background, and this polls until each is done or failed.
 * Nothing here holds a long request open, so a big song can't time out.
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

/**
 * Upload every stem and queue it. Returns the states (all `waiting`) and the
 * song's audio address; follow with `waitForStems`.
 */
export async function uploadStems(
  bandId: string,
  songId: string,
  stems: { stemId: string; file: File }[],
  normalize: boolean,
  onUpdate: (states: StemJobState[]) => void,
): Promise<{ states: StemJobState[]; publicBase: string }> {
  const base = songUrl(bandId, songId);
  const { jobs, publicBase } = await api<{ jobs: { id: string; stemId: string; uploadUrl: string }[]; publicBase: string }>(
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
  const set = (jobId: string, patch: Partial<StemJobState>) => {
    states = states.map((s) => (s.jobId === jobId ? { ...s, ...patch } : s));
    onUpdate(states);
  };
  onUpdate(states);

  // Two at a time: keeps the connection busy without starving each upload.
  const queue = [...jobs];
  const worker = async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      const { file } = stems.find((s) => s.stemId === j!.stemId)!;
      await uploadFileWithProgress(j.uploadUrl, file, (sent, total) => set(j!.id, { progress: total ? sent / total : 0 }));
      set(j.id, { phase: 'waiting', progress: 0 });
    }
  };
  await Promise.all([worker(), worker()]);

  await api('POST', `${base}/queue`, { jobIds: jobs.map((j) => j.id) });
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
    const { jobs } = await api<{ jobs: JobView[] }>('GET', `${songUrl(bandId, songId)}?jobs=${ids}`);
    states = states.map((s) => {
      const j = jobs.find((x) => x.id === s.jobId);
      if (!j) return s;
      const phase = j.status === 'running' ? 'transcoding' : j.status === 'queued' ? 'waiting'
        : j.status === 'uploading' ? 'uploading' : j.status;
      return { ...s, phase, progress: j.progress, error: j.error };
    });
    onUpdate(states);
    if (states.every((s) => s.phase === 'done' || s.phase === 'failed')) return states;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Put a failed stem back in the queue. */
export async function retryStem(bandId: string, songId: string, jobId: string): Promise<void> {
  await api('POST', `${songUrl(bandId, songId)}/${jobId}/retry`);
}

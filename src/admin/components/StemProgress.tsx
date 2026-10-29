import type { StemJobState } from '../utils/stemJobs';

const LABELS: Record<StemJobState['phase'], string> = {
  uploading: 'Uploading',
  waiting: 'Waiting',
  transcoding: 'Transcoding',
  done: 'Done',
  failed: 'Failed',
};

/**
 * One row per stem while it uploads and transcodes: name, phase, a bar, and
 * — when `onRetry` is given — Retry for a failed one.
 */
export function StemProgress({ stems, onRetry, retrying = false }: {
  stems: StemJobState[];
  onRetry?: (jobId: string) => void;
  retrying?: boolean;
}) {
  const done = stems.filter((s) => s.phase === 'done').length;
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-400">
        {done === stems.length ? 'All stems ready.' : `Preparing stems — ${done} of ${stems.length} ready. Keep this page open.`}
      </p>
      <ul className="space-y-2">
        {stems.map((s) => {
          const pct = Math.round(s.progress * 100);
          const width = s.phase === 'done' ? 100 : s.phase === 'waiting' ? 0 : pct;
          const colour = s.phase === 'failed' ? 'bg-red-500' : s.phase === 'done' ? 'bg-green-500'
            : s.phase === 'uploading' ? 'bg-blue-500' : 'bg-purple-500';
          return (
            <li key={s.jobId} className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="flex-1 min-w-0 truncate text-gray-200" title={s.filename}>{s.filename}</span>
                <span className={s.phase === 'failed' ? 'text-red-400' : 'text-gray-400'}>
                  {LABELS[s.phase]}{(s.phase === 'uploading' || s.phase === 'transcoding') && ` ${pct}%`}
                </span>
                {s.phase === 'failed' && onRetry && (
                  <button
                    onClick={() => onRetry(s.jobId)}
                    disabled={retrying}
                    className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-gray-200"
                  >
                    Retry
                  </button>
                )}
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full transition-all ${colour}`} style={{ width: `${width}%` }} />
              </div>
              {s.phase === 'failed' && s.error && <p className="text-xs text-red-400">{s.error}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

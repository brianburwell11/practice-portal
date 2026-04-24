import { useEffect, useMemo, useState } from 'react';
import { useBandStore } from '../store/bandStore';
import { useSetlistStore } from '../store/setlistStore';
import { r2Url } from '../utils/url';
import { DeleteSetlistModal } from './DeleteSetlistModal';
import type { SetlistConfig } from '../audio/types';

interface Props {
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ViewAllSetlistsModal({ onClose }: Props) {
  const currentBand = useBandStore((s) => s.currentBand);
  const index = useSetlistStore((s) => s.index);

  const [durations, setDurations] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!currentBand || !index) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const bandId = currentBand.id;
        const setlistConfigs = await Promise.all(
          index.map(async (entry) => {
            const res = await fetch(r2Url(`${bandId}/setlists/${entry.id}.json`));
            if (!res.ok) return null;
            return (await res.json()) as SetlistConfig;
          }),
        );

        const songIds = new Set<string>();
        for (const cfg of setlistConfigs) {
          if (!cfg) continue;
          for (const e of cfg.entries) if (e.type === 'song') songIds.add(e.songId);
        }

        const songDurations = new Map<string, number>();
        await Promise.all(
          [...songIds].map(async (songId) => {
            try {
              const res = await fetch(r2Url(`${bandId}/songs/${songId}/config.json`));
              if (!res.ok) return;
              const cfg = await res.json();
              songDurations.set(songId, cfg.durationSeconds ?? 0);
            } catch {
              // skip
            }
          }),
        );

        const totals: Record<string, number> = {};
        for (let i = 0; i < index.length; i++) {
          const cfg = setlistConfigs[i];
          if (!cfg) continue;
          let total = 0;
          for (const e of cfg.entries) {
            if (e.type === 'song') total += songDurations.get(e.songId) ?? 0;
          }
          totals[index[i].id] = total;
        }

        if (!cancelled) setDurations(totals);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? 'Failed to load setlists');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentBand, index]);

  const sortedIndex = useMemo(() => {
    if (!index) return [];
    return [...index].sort((a, b) => a.name.localeCompare(b.name));
  }, [index]);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
        onClick={onClose}
      >
        <div
          className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-100">All Setlists</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-200 text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300 mb-4">
                {error}
              </div>
            )}

            {sortedIndex.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">
                No setlists yet.
              </div>
            ) : (
              <ul className="divide-y divide-gray-800">
                {sortedIndex.map((entry) => {
                  const total = durations[entry.id];
                  return (
                    <li key={entry.id} className="flex items-center gap-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-100 truncate">{entry.name}</div>
                        <div className="text-xs text-gray-500 font-mono">
                          {loading && total === undefined
                            ? '…'
                            : total !== undefined
                            ? formatDuration(total)
                            : '—'}
                        </div>
                      </div>
                      <button
                        onClick={() => setDeleteTarget({ id: entry.id, name: entry.name })}
                        className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-xs font-medium text-gray-100"
                      >
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="px-6 py-3 border-t border-gray-700 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {deleteTarget && (
        <DeleteSetlistModal
          setlistId={deleteTarget.id}
          setlistName={deleteTarget.name}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}

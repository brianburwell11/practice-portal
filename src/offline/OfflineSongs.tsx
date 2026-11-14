import { useEffect, useState } from 'react';
import { confirmDialog } from '../store/dialogStore';
import { clearOfflineCache, OFFLINE_CACHE_ENABLED, OFFLINE_CAP_BYTES, offlineUsageBytes } from './offline';
import { usePinStore } from './pinStore';

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

/**
 * The account menu's section about songs kept on this device: what's
 * "Available offline" (with a way to stop keeping each), the space it and
 * recently played songs take, and a button to clear it all. Nothing when the
 * offline cache is off.
 */
export function OfflineSongs() {
  const [bytes, setBytes] = useState<{ pinned: number; played: number } | null>(null);
  const [clearing, setClearing] = useState(false);
  const load = usePinStore((s) => s.load);
  const pins = usePinStore((s) => s.pins);
  const progress = usePinStore((s) => s.progress);
  const unpin = usePinStore((s) => s.unpin);
  const pinList = Object.values(pins).sort((a, b) => a.label.localeCompare(b.label));
  const busy = Object.keys(progress).length > 0;

  useEffect(() => {
    if (!OFFLINE_CACHE_ENABLED) return;
    void load();
    let cancelled = false;
    void offlineUsageBytes().then((b) => { if (!cancelled) setBytes(b); });
    return () => { cancelled = true; };
    // Re-measured when a download finishes or a pin goes.
  }, [load, pins, busy]);

  if (!OFFLINE_CACHE_ENABLED || bytes === null) return null;

  return (
    <div className="px-4 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div>Offline songs</div>
          <div className="text-xs text-gray-400">
            {mb(bytes.pinned)} MB kept offline · {mb(bytes.played)} MB of {mb(OFFLINE_CAP_BYTES)} MB recently played
          </div>
        </div>
        <button
          onClick={async () => {
            if (pinList.length > 0 && !(await confirmDialog({
              title: 'Clear offline songs?',
              message: 'Everything kept offline on this device goes, including songs and setlists you made available offline.',
              confirmLabel: 'Clear',
              danger: true,
            }))) return;
            setClearing(true);
            await clearOfflineCache();
            usePinStore.setState({ pins: {}, errors: {} });
            setBytes({ pinned: 0, played: 0 });
            setClearing(false);
          }}
          disabled={clearing || busy || (bytes.pinned + bytes.played === 0 && pinList.length === 0)}
          className="shrink-0 rounded px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:hover:bg-gray-800"
        >
          {clearing ? 'Clearing' : 'Clear'}
        </button>
      </div>
      {pinList.length > 0 && (
        <ul className="space-y-0.5">
          {pinList.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-xs">
              <span className={p.ready ? 'text-green-400' : 'text-yellow-400'} aria-hidden="true">{p.ready ? '●' : '○'}</span>
              <span className="flex-1 min-w-0 truncate text-gray-300" title={p.ready ? 'Available offline' : 'Not fully downloaded'}>
                {p.label}{p.kind === 'setlist' ? ' (setlist)' : ''}
              </span>
              <button
                onClick={() => unpin(p.id)}
                disabled={!!progress[p.id]}
                className="shrink-0 text-gray-500 hover:text-gray-200 disabled:opacity-50"
                aria-label={`Stop keeping “${p.label}” offline`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

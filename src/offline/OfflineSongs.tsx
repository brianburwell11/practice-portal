import { useEffect, useState } from 'react';
import { clearOfflineCache, OFFLINE_CACHE_ENABLED, OFFLINE_CAP_BYTES, offlineUsageBytes } from './offline';

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

/**
 * The account menu's line about songs kept on this device for offline use:
 * how much space they take, and a button to clear them. Nothing when the
 * offline cache is off.
 */
export function OfflineSongs() {
  const [bytes, setBytes] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!OFFLINE_CACHE_ENABLED) return;
    let cancelled = false;
    void offlineUsageBytes().then((b) => { if (!cancelled) setBytes(b); });
    return () => { cancelled = true; };
  }, []);

  if (!OFFLINE_CACHE_ENABLED || bytes === null) return null;

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2">
      <div className="min-w-0">
        <div>Offline songs</div>
        <div className="text-xs text-gray-400">{mb(bytes)} MB of {mb(OFFLINE_CAP_BYTES)} MB on this device</div>
      </div>
      <button
        onClick={async () => {
          setClearing(true);
          await clearOfflineCache();
          setBytes(0);
          setClearing(false);
        }}
        disabled={clearing || bytes === 0}
        className="shrink-0 rounded px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:hover:bg-gray-800"
      >
        {clearing ? 'Clearing' : 'Clear'}
      </button>
    </div>
  );
}

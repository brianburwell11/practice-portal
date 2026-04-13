import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { songConfigSchema } from '../config/schema';
import type { SongConfig } from '../audio/types';
import { r2Url } from '../utils/url';
import { useBandStore } from '../store/bandStore';
import { AlignmentCanvas, type AlignmentCanvasStem } from './components/AlignmentCanvas';

interface LoadedStem {
  id: string;
  label: string;
  color: string;
  buffer: AudioBuffer;
  offsetSec: number;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; config: SongConfig; stems: LoadedStem[] };

export default function AlignSongPage() {
  const { songId = '', bandSlug = '' } = useParams();
  const navigate = useNavigate();
  const currentBand = useBandStore((s) => s.currentBand);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Track original offsets so we can detect dirty state for the unsaved-warning
  const originalOffsetsRef = useRef<Record<string, number>>({});

  // Decode in a single shared AudioContext that we close on unmount
  useEffect(() => {
    if (!songId || !currentBand) {
      if (!songId) setLoad({ kind: 'error', message: 'No song ID in URL' });
      return;
    }
    let cancelled = false;
    const ctx = new AudioContext();

    (async () => {
      try {
        const configRes = await fetch(r2Url(`${currentBand.id}/songs/${songId}/config.json`));
        if (!configRes.ok) {
          throw new Error(`Song "${songId}" config not found (${configRes.status})`);
        }
        const config = songConfigSchema.parse(await configRes.json());

        const audioBase = r2Url(`${currentBand.id}/songs/${songId}`);
        const stems: LoadedStem[] = await Promise.all(
          config.stems.map(async (sc) => {
            const url = `${audioBase}/${encodeURIComponent(sc.file)}`;
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`Failed to fetch ${sc.file} (${resp.status})`);
            const bytes = await resp.arrayBuffer();
            const buffer = await ctx.decodeAudioData(bytes);
            return {
              id: sc.id,
              label: sc.label,
              color: sc.color,
              buffer,
              offsetSec: sc.offsetSec ?? 0,
            };
          }),
        );

        if (cancelled) return;
        originalOffsetsRef.current = Object.fromEntries(stems.map((s) => [s.id, s.offsetSec]));
        setLoad({ kind: 'ready', config, stems });
      } catch (err: any) {
        if (!cancelled) setLoad({ kind: 'error', message: err.message ?? 'Failed to load song' });
      }
    })();

    return () => {
      cancelled = true;
      ctx.close().catch(() => {});
    };
  }, [songId, currentBand]);

  const dirty = useMemo(() => {
    if (load.kind !== 'ready') return false;
    return load.stems.some(
      (s) => Math.round(s.offsetSec * 1000) !== Math.round((originalOffsetsRef.current[s.id] ?? 0) * 1000),
    );
  }, [load]);

  // Warn on navigation away if dirty
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const handleOffsetChange = useCallback((id: string, offsetSec: number) => {
    setLoad((cur) => {
      if (cur.kind !== 'ready') return cur;
      return {
        ...cur,
        stems: cur.stems.map((s) => (s.id === id ? { ...s, offsetSec } : s)),
      };
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (load.kind !== 'ready' || !currentBand) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Update offsets in config
      const offsetById = new Map(load.stems.map((s) => [s.id, s.offsetSec]));
      const bufferById = new Map(load.stems.map((s) => [s.id, s.buffer]));
      const updatedStems = load.config.stems.map((sc) => {
        const offsetSec = offsetById.get(sc.id) ?? sc.offsetSec ?? 0;
        const out = { ...sc };
        if (offsetSec) {
          out.offsetSec = offsetSec;
        } else {
          delete out.offsetSec;
        }
        return out;
      });

      // Recompute duration to span the aligned mix
      const alignedEnd = updatedStems.reduce((max, sc) => {
        const dur = bufferById.get(sc.id)?.duration;
        if (dur === undefined) return max;
        return Math.max(max, (sc.offsetSec ?? 0) + dur);
      }, 0);
      const durationSeconds = Math.max(load.config.durationSeconds, alignedEnd);

      const updatedConfig: SongConfig = {
        ...load.config,
        stems: updatedStems,
        durationSeconds,
      };

      const res = await fetch(`/api/bands/${currentBand.id}/songs/${songId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Save failed (${res.status})`);
      }

      // Reset baseline so dirty becomes false
      originalOffsetsRef.current = Object.fromEntries(load.stems.map((s) => [s.id, s.offsetSec]));
      setLoad({ ...load, config: updatedConfig });
      navigate(`/${bandSlug}`);
    } catch (err: any) {
      setSaveError(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [load, currentBand, songId, navigate, bandSlug]);

  const handleCancel = () => {
    if (dirty && !window.confirm('Discard alignment changes?')) return;
    navigate(`/${bandSlug}`);
  };

  // ---- render ----------------------------------------------------------

  if (load.kind === 'loading') {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 p-8">
        <p className="text-gray-400">Loading song & decoding stems…</p>
      </div>
    );
  }
  if (load.kind === 'error') {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 p-8 space-y-4">
        <p className="text-red-400">{load.message}</p>
        <button
          onClick={() => navigate(`/${bandSlug}`)}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          Back
        </button>
      </div>
    );
  }

  const canvasStems: AlignmentCanvasStem[] = load.stems.map((s) => ({
    id: s.id,
    label: s.label,
    color: s.color,
    buffer: s.buffer,
    offsetSec: s.offsetSec,
  }));

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Align Stems</h1>
          <p className="text-xs text-gray-400">
            {load.config.title} <span className="text-gray-600">/ {load.config.artist}</span>
          </p>
        </div>
        <button
          onClick={handleCancel}
          disabled={saving}
          className="text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50"
        >
          Back to app
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <AlignmentCanvas stems={canvasStems} onOffsetChange={handleOffsetChange} />

        {saveError && (
          <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
            {saveError}
          </div>
        )}

        <div className="flex justify-between items-center">
          <button
            onClick={handleCancel}
            disabled={saving}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-sm"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            {dirty && <span className="text-xs text-gray-500">unsaved changes</span>}
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
            >
              {saving ? 'Saving…' : 'Save alignment'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

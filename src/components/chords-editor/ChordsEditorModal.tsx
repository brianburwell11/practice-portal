import { useCallback, useMemo, useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { useBandStore } from '../../store/bandStore';
import { useChordsEditorStore, type ChordsEditorMode } from '../../store/chordsEditorStore';
import { useChordsStore } from '../../store/chordsStore';
import { confirmDiscard, toast } from '../../store/dialogStore';
import { beatGrid, isOffGrid } from '../../audio/chordGrid';
import type { ChordsData } from '../../audio/chordsTypes';
import { ChordsGridPane } from './ChordsGridPane';
import { ChordsStampPane } from './ChordsStampPane';
import { saveEdit } from '../../offline/sync';

const MODES: { id: ChordsEditorMode; label: string }[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'stamp', label: 'Stamp' },
];

/**
 * The chords editor, in two modes: Grid (type chords onto the beat grid)
 * and Stamp (tap chords in at the playhead, for free time and songs without
 * a tapMap). This shell owns the toolbar, the off-grid notice and save; each
 * pane owns its own controls and keys. The chord lane above shows the draft.
 */
export function ChordsEditorModal() {
  const selectedSong = useSongStore((s) => s.selectedSong);
  const currentBand = useBandStore((s) => s.currentBand);
  const { isOpen, mode, chords, dirty, close, setMode, snapOffGrid } = useChordsEditorStore();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grid = useMemo(
    () => beatGrid(selectedSong?.tapMap, selectedSong?.timeSignatureMap),
    [selectedSong?.tapMap, selectedSong?.timeSignatureMap],
  );
  const offGrid = useMemo(() => chords.filter((c) => isOffGrid(c.time, grid)).length, [chords, grid]);

  const handleClose = useCallback(async () => {
    if (dirty && !(await confirmDiscard())) return;
    close();
  }, [dirty, close]);

  const handleSave = async () => {
    if (!currentBand || !selectedSong) return;
    setSaving(true);
    setError(null);
    try {
      const data: ChordsData = { chords };
      // Kept on this device first, so it isn't lost offline.
      const outcome = await saveEdit({
        key: `${currentBand.id}/songs/${selectedSong.id}/chords.json`,
        url: `/api/bands/${currentBand.id}/songs/${selectedSong.id}/chords`,
        label: `${selectedSong.title} chords`,
        band: currentBand.id,
        data,
      });
      useChordsStore.getState().setChords(data.chords);
      close();
      if (outcome === 'queued') toast('Saved on this device. It syncs when you’re back online.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !selectedSong) return null;

  const btn = 'px-2.5 md:px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors';

  return (
    <div className="editor-slot flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-2 px-3 md:px-5 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-gray-800 shrink-0" role="tablist" aria-label="Editor mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => setMode(m.id)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  mode === m.id ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {offGrid > 0 && (
            <span className="flex items-center gap-2 text-xs text-orange-300 min-w-0">
              <span className="truncate">{offGrid} {offGrid === 1 ? 'chord is' : 'chords are'} off the grid</span>
              <button
                type="button"
                className="shrink-0 rounded bg-orange-500/20 hover:bg-orange-500/30 px-2 py-0.5 text-orange-200"
                title="Move them to the nearest half beat (the beat map probably changed since they were placed)"
                onClick={() => {
                  const moved = snapOffGrid(grid);
                  if (moved) toast(`Snapped ${moved} ${moved === 1 ? 'chord' : 'chords'} to the grid`);
                }}
              >
                Snap to grid
              </button>
            </span>
          )}
          {error && <span className="text-xs text-red-400 truncate">{error}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="px-3 md:px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-accent-ink transition-colors"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button className={btn} onClick={handleClose}>
            Close
          </button>
        </div>
      </div>

      {mode === 'grid' ? <ChordsGridPane /> : <ChordsStampPane />}
    </div>
  );
}

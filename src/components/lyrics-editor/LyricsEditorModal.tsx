import { useState, useCallback } from 'react';
import { useSongStore } from '../../store/songStore';
import { useBandStore } from '../../store/bandStore';
import { useLyricsEditorStore } from '../../store/lyricsEditorStore';
import { LyricsInputStep } from './LyricsInputStep';
import { LyricsSyncStep } from './LyricsSyncStep';

import type { LyricsData } from '../../audio/lyricsTypes';

export function LyricsEditorModal() {
  const { isOpen, step, lines, rawText, dirty, close, setStep } =
    useLyricsEditorStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const currentBand = useBandStore((s) => s.currentBand);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    if (dirty) {
      if (!window.confirm('You have unsaved changes. Discard them?')) return;
    }
    close();
  }, [dirty, close]);

  if (!isOpen || !selectedSong) return null;

  const handleSave = async (unsynced?: boolean) => {
    if (!currentBand) return;

    setSaving(true);
    setError(null);

    try {
      // If saving from step 1, parse text into lines (preserving blank lines)
      let saveLines = lines;
      if (unsynced && step === 'input') {
        saveLines = rawText
          .split('\n')
          .map((l) => {
            if (/^\[instrumental\]$/i.test(l.trim())) {
              return { text: '', time: null, instrumental: true };
            }
            return { text: l.trim(), time: null };
          });
      }

      const data: LyricsData = { lines: saveLines };
      const res = await fetch(
        `/api/bands/${currentBand.id}/songs/${selectedSong.id}/lyrics`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
      );

      if (!res.ok) throw new Error(`Save failed: ${res.status} ${res.statusText}`);
      close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const hasText = rawText.trim().length > 0;
  const hasLines = lines.length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-100">
            Lyrics Editor
          </h2>
          <span className="text-sm text-gray-400">
            {selectedSong.title}
          </span>
          <span className="text-xs text-gray-600">
            Step {step === 'input' ? '1: Add Lyrics' : '2: Sync to Playback'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs text-red-400 mr-2">{error}</span>
          )}
          {step === 'input' && (
            <>
              <button
                className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-gray-300 transition-colors"
                onClick={() => handleSave(true)}
                disabled={!hasText || saving}
              >
                {saving ? 'Saving...' : 'Save Without Syncing'}
              </button>
              <button
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white transition-colors"
                onClick={() => setStep('sync')}
                disabled={!hasText}
              >
                Next: Sync
              </button>
            </>
          )}
          {step === 'sync' && (
            <>
              <button
                className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors"
                onClick={() => setStep('input')}
              >
                Back to Edit
              </button>
              <button
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white transition-colors"
                onClick={() => handleSave()}
                disabled={!hasLines || saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
          <button
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors"
            onClick={handleClose}
          >
            Close
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 px-5 py-4 flex flex-col">
        {step === 'input' ? <LyricsInputStep /> : <LyricsSyncStep />}
      </div>
    </div>
  );
}

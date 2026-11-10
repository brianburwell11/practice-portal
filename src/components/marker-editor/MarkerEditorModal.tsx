import { useState, useEffect, useRef, useCallback } from 'react';
import { useSongStore } from '../../store/songStore';
import { useBandStore } from '../../store/bandStore';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { SectionList } from './SectionList';
import { parseXscFile } from '../../audio/xscParser';
import { autoLabelSection } from '../../audio/tapMapUtils';
import { buildXscContent } from '../../audio/xscExporter';
import { buildMusicXmlContent } from '../../audio/musicXmlExporter';
import { renderStereoDownmix } from '../../audio/mixdown';
import { encodeWav, interleaveStereo } from '../../admin/utils/audioConvert';
import { confirmDialog, confirmDiscard } from '../../store/dialogStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { TapPadButton } from '../ui/TapPadButton';
import type { TapMapEntry } from '../../audio/types';
import { useTransportStore } from '../../store/transportStore';
import { measureBeatAt } from '../../audio/tempoUtils';

export function MarkerEditorModal() {
  const {
    isOpen, tapMap, dirty, selectedIndex,
    close, importTapMap, addEntry, deleteEntry, updateEntryType, setSelectedIndex, undo, onComplete,
  } = useMarkerEditorStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const setSelectedSong = useSongStore((s) => s.setSelectedSong);
  const currentBand = useBandStore((s) => s.currentBand);
  const engine = useAudioEngine();
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const coarse = useMediaQuery('(pointer: coarse)');
  const position = useTransportStore((s) => s.position);
  // Bumped when S/M/B fire from the keyboard so the matching pad lights up.
  const [pulses, setPulses] = useState({ section: 0, measure: 0, beat: 0 });

  // Add an entry of the given type at the live playhead. Shared by the
  // S/M/B keys and the touch pads.
  const listRef = useRef<HTMLDivElement>(null);
  const tap = useCallback((type: TapMapEntry['type']) => {
    const time = engine.clock.currentTime;
    if (type === 'section') addEntry({ time, type, label: autoLabelSection(tapMap) });
    else addEntry({ time, type });
    // Bring the section row this tap landed in (or created) into view.
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      let row: HTMLElement | null = null;
      for (const el of list.querySelectorAll<HTMLElement>('[data-section-time]')) {
        if (Number(el.dataset.sectionTime) <= time) row = el;
        else break;
      }
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [engine, tapMap, addEntry]);

  // Close the More menu on outside tap/click
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!moreMenuRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [moreOpen]);

  // Keyboard shortcuts \u2014 S/M/B add an entry at the current playhead,
  // Backspace/Delete removes the selected one, Z (or Cmd/Ctrl+Z) undoes.
  // Guarded to only fire while the editor is open so the bindings don't
  // interfere with normal app use.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      if (selectedIndex !== null && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault();
        deleteEntry(selectedIndex);
        return;
      }

      const key = e.key.toUpperCase();
      if (key === 'Z') { undo(); return; }

      const type = key === 'S' ? 'section' : key === 'M' ? 'measure' : key === 'B' ? 'beat' : null;
      if (type) {
        tap(type);
        setPulses((p) => ({ ...p, [type]: p[type] + 1 }));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, selectedIndex, tap, deleteEntry, undo]);

  if (!isOpen || (!selectedSong && !onComplete)) return null;

  const handleSave = async () => {
    if (onComplete) {
      onComplete(tapMap);
      close();
      return;
    }

    if (!selectedSong) return;

    setSaving(true);
    setError(null);

    const updatedConfig = {
      ...selectedSong,
      tapMap: tapMap,
    };

    try {
      const res = await fetch(`/api/bands/${currentBand!.id}/songs/${selectedSong.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });

      if (!res.ok) {
        throw new Error(`Save failed: ${res.status} ${res.statusText}`);
      }

      setSelectedSong(updatedConfig);
      close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async () => {
    if (dirty) {
      if (!(await confirmDiscard())) return;
    }
    close();
  };

  const handleImportXsc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const content = reader.result as string;
      const entries = parseXscFile(content);
      if (tapMap.length > 0) {
        if (!(await confirmDialog({ title: 'Replace the existing tap map?', confirmLabel: 'Replace', danger: true }))) return;
      }
      importTapMap(entries);
    };
    reader.readAsText(file);

    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportXsc = async () => {
    if (tapMap.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      const rendered = await renderStereoDownmix(engine);
      const interleaved = interleaveStereo(rendered);
      const wavBytes = encodeWav(interleaved, rendered.sampleRate, 2);

      const rawName =
        (selectedSong?.title && selectedSong.title.trim()) || selectedSong?.id || 'tapmap';
      const safeName = rawName.replace(/[\\/:*?"<>|]/g, '_');
      const wavFileName = `${safeName}.wav`;
      const xscFileName = `${safeName}.xsc`;

      const xscText = buildXscContent(tapMap, {
        wavFileName,
        wavInfo: {
          frameCount: rendered.length,
          channels: 2,
          sampleRate: rendered.sampleRate,
          durationSeconds: rendered.duration,
          totalBytes: wavBytes.byteLength,
          bitsPerSample: 16,
        },
      });

      triggerDownload(
        new Blob([xscText], { type: 'text/plain;charset=utf-8' }),
        xscFileName,
      );
      triggerDownload(new Blob([wavBytes], { type: 'audio/wav' }), wavFileName);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleExportMusicXml = () => {
    if (tapMap.length === 0) return;
    setError(null);
    try {
      const rawName =
        (selectedSong?.title && selectedSong.title.trim()) ||
        selectedSong?.id ||
        'tapmap';
      const safeName = rawName.replace(/[\\/:*?"<>|]/g, '_');
      const xml = buildMusicXmlContent(tapMap, { title: rawName });
      triggerDownload(
        new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }),
        `${safeName}.musicxml`,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const btn = 'px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-gray-300 transition-colors';
  const menuItem = 'block w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-40 transition-colors';
  const nextSectionLabel = autoLabelSection(tapMap);
  const selectedEntry = selectedIndex !== null ? tapMap[selectedIndex] : undefined;
  // What a tap at the playhead would become: the next measure number and
  // the next beat within the current measure (sections count as measures,
  // same as the transport bar's measure|beat readout).
  const mb = measureBeatAt(tapMap, position);
  const nextMeasure = (mb?.measure ?? 0) + 1;
  const nextBeat = mb
    ? mb.beat + 1
    : tapMap.filter((e) => e.type === 'beat' && e.time <= position).length + 1;

  // Tap pads: the S/M/B keys as buttons. On desktop they show their
  // shortcut and light up when the key is pressed.
  const pads = (
    <div className="grid grid-cols-3 gap-2">
      <TapPadButton
        label="+ Section"
        shortcut={coarse ? undefined : 'S'}
        sublabel={nextSectionLabel}
        color="bg-amber-500 text-gray-900"
        size={coarse ? 'lg' : 'md'}
        pulse={pulses.section}
        onFire={() => tap('section')}
      />
      <TapPadButton
        label="+ Measure"
        shortcut={coarse ? undefined : 'M'}
        sublabel={String(nextMeasure)}
        color="bg-blue-700 text-white"
        size={coarse ? 'lg' : 'md'}
        pulse={pulses.measure}
        onFire={() => tap('measure')}
      />
      <TapPadButton
        label="+ Beat"
        shortcut={coarse ? undefined : 'B'}
        sublabel={String(nextBeat)}
        color="bg-gray-600 text-white"
        size={coarse ? 'lg' : 'md'}
        pulse={pulses.beat}
        onFire={() => tap('beat')}
      />
    </div>
  );

  return (
    <div className="theme-default bg-page flex-1 flex flex-col min-h-0">
      {/* Toolbar \u2014 mirrors the LyricsEditor layout: actions left/right,
          centered title, no song name (shown in the header above). On
          phones the file actions collapse into a More menu. */}
      <div className="relative flex items-center justify-between gap-2 px-3 md:px-5 py-2">
        <h2 className="absolute inset-0 hidden md:flex items-center justify-center text-sm font-semibold text-gray-100 pointer-events-none">
          Edit TapMap
        </h2>
        <div className="flex items-center gap-2 relative z-10 min-w-0">
          <button className={`${btn} hidden md:inline-block`} onClick={() => fileInputRef.current?.click()}>
            Import .xsc
          </button>
          <div ref={moreMenuRef} className="relative md:hidden">
            <button className={btn} onClick={() => setMoreOpen((v) => !v)}>
              More ▾
            </button>
            {moreOpen && (
              <div className="theme-default absolute left-0 top-full mt-1 z-20 min-w-[12rem] rounded border border-gray-600 bg-gray-800 shadow-lg py-1">
                <button className={menuItem} onClick={() => { setMoreOpen(false); fileInputRef.current?.click(); }}>
                  Import .xsc
                </button>
                <button className={menuItem} disabled={tapMap.length === 0 || exporting} onClick={() => { setMoreOpen(false); handleExportXsc(); }}>
                  {exporting ? 'Exporting…' : 'Export .xsc'}
                </button>
                <button className={menuItem} disabled={tapMap.length === 0 || exporting} onClick={() => { setMoreOpen(false); handleExportMusicXml(); }}>
                  Export MusicXML
                </button>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xsc"
            className="hidden"
            onChange={handleImportXsc}
          />
          {error && (
            <span className="text-xs text-red-400 ml-2 truncate">{error}</span>
          )}
        </div>
        <div className="flex items-center gap-2 relative z-10">
          <button
            className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white transition-colors"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            className={`${btn} hidden md:inline-block`}
            onClick={handleExportXsc}
            disabled={tapMap.length === 0 || exporting}
            title="Download a Transcribe! .xsc plus a stereo downmix .wav of the current mixer state"
          >
            {exporting ? 'Exporting…' : 'Export .xsc'}
          </button>
          <button
            className={`${btn} hidden md:inline-block`}
            onClick={handleExportMusicXml}
            disabled={tapMap.length === 0 || exporting}
            title="Download a blank single-staff MusicXML file with rehearsal marks at each section"
          >
            Export MusicXML
          </button>
          <button className={btn} onClick={handleClose}>
            Close
          </button>
        </div>
      </div>

      {/* Section list \u2014 centered, narrow, fills all available space
          between the toolbar and the footer. Internal scroll kicks in
          when rows exceed that space; `min-h-0` keeps the flex child
          from growing past its parent and pushing the page taller. */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto mt-3 max-w-2xl w-full mx-auto rounded-lg border border-gray-700">
        <SectionList />
      </div>

      {coarse ? (
        <div className="mt-3 max-w-2xl w-full mx-auto px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
          {pads}
          {selectedEntry && selectedIndex !== null ? (
            /* A marker is selected (tap it on the waveform or in the
               list): change its type in place, keeping its time. */
            <div className="grid grid-cols-4 gap-2">
              {(['section', 'measure', 'beat'] as const).map((type) => (
                <button
                  key={type}
                  className={`${btn} py-2.5 ${selectedEntry.type === type ? 'ring-1 ring-white/60 text-white' : ''}`}
                  disabled={selectedEntry.type === type}
                  onClick={() =>
                    updateEntryType(
                      selectedIndex,
                      type,
                      type === 'section' && !selectedEntry.label ? autoLabelSection(tapMap) : undefined,
                    )
                  }
                >
                  {type === 'section' ? 'Section' : type === 'measure' ? 'Measure' : 'Beat'}
                </button>
              ))}
              <button
                className={`${btn} py-2.5 text-red-300`}
                onClick={() => deleteEntry(selectedIndex)}
              >
                Delete
              </button>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <button className={`${btn} flex-1 py-2.5`} onClick={undo}>
              Undo
            </button>
            {selectedEntry && (
              <button className={`${btn} flex-1 py-2.5`} onClick={() => setSelectedIndex(null)}>
                Deselect {selectedEntry.type === 'section' ? `section ${selectedEntry.label ?? ''}`.trim() : selectedEntry.type}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 mb-3 max-w-2xl w-full mx-auto">{pads}</div>
          {/* Footer hints \u2014 mirrors the LyricsEditor footer style so the
            two editors feel like the same family. `mt-auto` pins it to
            the bottom of the flex column so the panel's breathing room
            sits between the list and the footer. */}
        <div className="mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-2 text-[10px] text-gray-600 border-t border-gray-700">
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">S</kbd> section</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">M</kbd> measure</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">B</kbd> beat</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">click</kbd> select</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">drag</kbd> move</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Del</kbd> remove</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘Z</kbd> undo</span>
        </div>
        </>
      )}
    </div>
  );
}

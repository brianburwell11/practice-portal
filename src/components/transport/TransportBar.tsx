import { useEffect, useState } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useMixerStore } from '../../store/mixerStore';
import { useLyricsStore } from '../../store/lyricsStore';
import { WaveformTimeline } from './WaveformTimeline';
import { MasterSliders } from './MasterSliders';
import { Skeleton } from '../ui/Loading';
import { formatTime } from '../../utils/formatTime';
import { measureBeatAt } from '../../audio/tempoUtils';
import { LoopButton, PlayPauseButton, StopButton } from './TransportButtons';
import { SheetMusicIcon } from '../sheet/SheetMusicIcon';
import { useSheetMusicStore } from '../../store/sheetMusicStore';
import { usePanelMinimizeStore } from '../../store/panelMinimizeStore';

import type { TapMapEntry } from '../../audio/types';

function parseTimeDigits(digits: string): number | null {
  if (!digits) return null;
  const padded = digits.padStart(3, '0');
  const s = parseInt(padded.slice(-2), 10);
  const m = parseInt(padded.slice(0, -2) || '0', 10);
  return m * 60 + s;
}

function formatTimeInput(digits: string): string {
  if (!digits) return '0:00';
  const padded = digits.slice(0, 4).padStart(3, '0');
  const s = padded.slice(-2);
  const m = padded.slice(0, -2) || '0';
  return `${parseInt(m, 10)}:${s}`;
}

function measureBeatToTime(tapMap: TapMapEntry[] | undefined, targetMeasure: number, targetBeat: number): number | null {
  if (!tapMap || tapMap.length === 0) return null;
  let measure = 0;
  let beat = 0;
  for (const entry of tapMap) {
    if (entry.type === 'section' || entry.type === 'measure') {
      measure++;
      beat = 1;
    } else {
      beat++;
    }
    if (measure === targetMeasure && beat === targetBeat) return entry.time;
    if (measure > targetMeasure) break;
  }
  // If exact beat not found, return the start of the target measure
  measure = 0;
  for (const entry of tapMap) {
    if (entry.type === 'section' || entry.type === 'measure') {
      measure++;
      if (measure === targetMeasure) return entry.time;
    }
    if (measure > targetMeasure) break;
  }
  return null;
}

// A made-up waveform for the placeholder: bar heights in %, the same every load.
const SKELETON_BARS = Array.from({ length: 64 }, (_, i) =>
  Math.round(45 + 25 * Math.sin(i * 0.45) + 15 * Math.sin(i * 1.7 + 1)),
);

/**
 * The waveform and overview strip's shape while the first song loads, the
 * same size as `WaveformTimeline`. Once stems are downloading, how many have
 * arrived runs along the bottom.
 */
function WaveformSkeleton({ progress }: { progress: { loaded: number; total: number } | null }) {
  return (
    <div className="flex flex-col gap-0.5" role="status">
      <span className="sr-only">
        {progress ? `Loading stems, ${progress.loaded} of ${progress.total}` : 'Loading the song'}
      </span>
      {/* Marked as the waveform: notes, lyrics and the score line up on its
          left edge, and look it up by this attribute. */}
      <div aria-hidden="true" data-waveform-timeline className="h-[80px] md:h-[108px] rounded bg-gray-800/60 flex items-center gap-[3px] px-2 overflow-hidden motion-safe:animate-pulse">
        {SKELETON_BARS.map((h, i) => (
          <div key={i} className="flex-1 min-w-[2px] rounded-full bg-gray-700" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-5 relative rounded overflow-hidden border border-gray-700/50">
          <Skeleton className="absolute inset-0 rounded-none" />
          {progress && (
            <div
              className="absolute inset-y-0 left-0 bg-blue-500/50 transition-all"
              style={{ width: `${Math.round((progress.loaded / progress.total) * 100)}%` }}
            />
          )}
        </div>
        {progress && (
          <span className="text-xs text-gray-500 shrink-0 font-mono">{progress.loaded}/{progress.total}</span>
        )}
      </div>
    </div>
  );
}

interface TransportBarProps {
  showSliders: boolean;
  onToggleSliders: () => void;
  /** An on-page editor is open. Phones show only play/pause, plus the
   *  mixer button for the TapMap editor. */
  minimal?: 'tapmap' | 'lyrics';
}

export function TransportBar({ showSliders, onToggleSliders, minimal }: TransportBarProps) {
  const engine = useAudioEngine();
  const { playing, position, duration, loopA, loopB, loopEnabled, toggleFollowPlayhead } = useTransportStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const loadProgress = useSongStore((s) => s.loadProgress);
  const mixerStems = useMixerStore((s) => s.stems);
  const globalSoloActive = useMixerStore((s) => s.globalSoloActive);
  const globalMuteActive = useMixerStore((s) => s.globalMuteActive);
  const toggleGlobalSolo = useMixerStore((s) => s.toggleGlobalSolo);
  const toggleGlobalMute = useMixerStore((s) => s.toggleGlobalMute);
  const clearSoloGroup = useMixerStore((s) => s.clearSoloGroup);
  const clearMuteGroup = useMixerStore((s) => s.clearMuteGroup);

  const disabled = !selectedSong;
  // A song on its way in, the first or the next: placeholders for the waveform and time.
  const songLoading = useSongStore((s) => s.loading || (!s.selectedSong && !s.manifest));
  const [showBookmark, setShowBookmark] = useState(false);
  const lyricsMobileVisible = useLyricsStore((s) => s.mobileVisible);
  const toggleLyricsMobileVisible = useLyricsStore((s) => s.toggleMobileVisible);
  const hasLyrics = useLyricsStore((s) => s.lines.length > 0);
  const hasSheetMusic = !!selectedSong?.sheetMusicUrl;
  const sheetMusicOpen = useSheetMusicStore((s) => s.fullViewOpen);
  const openSheetMusic = () => {
    // The full screen view lives in the sheet music panel, so bring it back if minimized.
    usePanelMinimizeStore.getState().restorePanel('sheet');
    useSheetMusicStore.getState().setFullViewOpen(true);
  };
  const [editingMeasure, setEditingMeasure] = useState(false);
  const [editingBeat, setEditingBeat] = useState(false);
  const [measureEditValue, setMeasureEditValue] = useState('');
  const [beatEditValue, setBeatEditValue] = useState('');
  const [editingTime, setEditingTime] = useState(false);
  const [timeEditValue, setTimeEditValue] = useState('');
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space' && !disabled) {
        e.preventDefault();
        playing ? engine.pause() : engine.play();
      }
      if (e.key === '[' && !disabled) {
        e.preventDefault();
        engine.setLoop(position, engine.loopB);
      }
      if (e.key === ']' && !disabled) {
        e.preventDefault();
        engine.setLoop(engine.loopA, position);
      }
      if ((e.key === '\\' || e.key === 'c') && !disabled) {
        e.preventDefault();
        if (loopA !== null && loopB !== null) {
          engine.setLoopEnabled(!loopEnabled);
        }
      }
      if (e.key === '|' && !disabled) {
        e.preventDefault();
        engine.clearLoop();
      }
      if (e.key === '`') {
        e.preventDefault();
        toggleFollowPlayhead();
      }
      if (e.key === 'm' && !disabled) {
        e.preventDefault();
        const newActive = !globalMuteActive;
        toggleGlobalMute();
        for (const [id, state] of Object.entries(mixerStems)) {
          if (state.muted) engine.setStemMuted(id, newActive);
        }
      }
      if (e.key === 'M' && !disabled) {
        e.preventDefault();
        for (const [id, state] of Object.entries(mixerStems)) {
          if (state.muted) engine.setStemMuted(id, false);
        }
        clearMuteGroup();
      }
      if (e.key === 's' && !disabled) {
        e.preventDefault();
        const newActive = !globalSoloActive;
        toggleGlobalSolo();
        for (const [id, state] of Object.entries(mixerStems)) {
          if (state.soloed) engine.setStemSoloed(id, newActive);
        }
      }
      if (e.key === 'S' && !disabled) {
        e.preventDefault();
        for (const [id, state] of Object.entries(mixerStems)) {
          if (state.soloed) engine.setStemSoloed(id, false);
        }
        clearSoloGroup();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [engine, playing, disabled, loopA, loopB, loopEnabled, position, toggleFollowPlayhead, mixerStems, globalSoloActive, globalMuteActive, toggleGlobalSolo, toggleGlobalMute, clearSoloGroup, clearMuteGroup]);

  return (
    <div className="flex flex-col md:flex-row md:items-center md:gap-4 px-4 py-3 border-b border-gray-700">
      {/* Desktop: controls cluster (buttons + sliders grouped together, shrink-0) */}
      <div className="hidden md:flex md:flex-col md:gap-1 md:shrink-0">
        {/* Transport buttons — centered over sliders */}
        <div className="flex items-center justify-center gap-2">
          <StopButton />
          <PlayPauseButton />
          <LoopButton verb="Click" />
        </div>

        {/* Volume + Speed sliders */}
        <MasterSliders />
      </div>

      {/* Waveform + timestamp — full width on mobile (row 1), flex-1 on desktop */}
      <div className="md:flex-1 md:min-w-0 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          {songLoading ? <WaveformSkeleton progress={loadProgress} /> : <WaveformTimeline />}
        </div>
        {songLoading ? (
          <div className="hidden md:flex md:flex-col md:items-center md:gap-2 shrink-0">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-10" />
          </div>
        ) : (
        <div className="hidden md:flex md:flex-col md:items-center font-mono text-sm text-gray-300 shrink-0 -mt-1">
          <div>
            {editingTime ? (
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={formatTimeInput(timeEditValue)}
                onChange={(e) => setTimeEditValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onBlur={() => {
                  setEditingTime(false);
                  const t = parseTimeDigits(timeEditValue);
                  if (t !== null && t >= 0 && t <= duration) engine.seek(t);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { setEditingTime(false); const t = parseTimeDigits(timeEditValue); if (t !== null && t >= 0 && t <= duration) engine.seek(t); }
                  if (e.key === 'Escape') setEditingTime(false);
                }}
                className="w-[5ch] text-sm text-center bg-gray-700 border border-gray-500 rounded px-0.5 outline-none focus:border-blue-500 text-gray-300 font-mono"
              />
            ) : (
              <button
                onClick={() => { if (playing) engine.pause(); setTimeEditValue(''); setEditingTime(true); }}
                className="hover:text-white cursor-text"
              >{formatTime(position)}</button>
            )}
            <span> / {formatTime(duration)}</span>
          </div>
          {(() => {
            const hasTapMap = selectedSong?.tapMap && selectedSong.tapMap.length > 0;
            if (!hasTapMap) return null;
            const mb = measureBeatAt(selectedSong?.tapMap, position);
            const measure = mb?.measure ?? 0;
            const beat = mb?.beat ?? 0;

            const startMeasureEdit = () => {
              if (playing) engine.pause();
              setMeasureEditValue(String(measure));
              setEditingMeasure(true);
            };
            const commitMeasure = () => {
              setEditingMeasure(false);
              const num = parseInt(measureEditValue, 10);
              if (!isNaN(num) && num > 0) {
                const t = measureBeatToTime(selectedSong?.tapMap, num, 1);
                if (t !== null) engine.seek(t);
              }
            };
            const startBeatEdit = () => {
              if (playing) engine.pause();
              setBeatEditValue(String(beat));
              setEditingBeat(true);
            };
            const commitBeat = () => {
              setEditingBeat(false);
              const num = parseInt(beatEditValue, 10);
              if (!isNaN(num) && num > 0) {
                const t = measureBeatToTime(selectedSong?.tapMap, measure || 1, num);
                if (t !== null) engine.seek(t);
              }
            };

            return (
              <div className="text-gray-500 flex items-center">
                {editingMeasure ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={measureEditValue}
                    onChange={(e) => setMeasureEditValue(e.target.value)}
                    onBlur={commitMeasure}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitMeasure(); if (e.key === 'Escape') setEditingMeasure(false); }}
                    className="w-[3ch] text-sm text-right bg-gray-700 border border-gray-500 rounded px-0.5 outline-none focus:border-blue-500 text-gray-300 font-mono"
                  />
                ) : (
                  <button onClick={startMeasureEdit} className="inline-block w-[2.5ch] text-right hover:text-gray-300 cursor-text">{measure}</button>
                )}
                <span className="text-gray-600 mx-0.5">|</span>
                {editingBeat ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={beatEditValue}
                    onChange={(e) => setBeatEditValue(e.target.value)}
                    onBlur={commitBeat}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitBeat(); if (e.key === 'Escape') setEditingBeat(false); }}
                    className="w-[2ch] text-sm bg-gray-700 border border-gray-500 rounded px-0.5 outline-none focus:border-blue-500 text-gray-300 font-mono"
                  />
                ) : (
                  <button onClick={startBeatEdit} className="inline-block w-[1.5ch] hover:text-gray-300 cursor-text">{beat}</button>
                )}
              </div>
            );
          })()}
          {(() => {
            const sections = selectedSong?.tapMap?.filter((e) => e.type === 'section');
            if (!sections || sections.length === 0) return null;
            return (
              <select
                className="text-xs bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-gray-400 cursor-pointer outline-none focus:border-blue-500 font-sans"
                value=""
                onChange={(e) => {
                  const time = parseFloat(e.target.value);
                  if (!isNaN(time)) {
                    if (playing) engine.pause();
                    engine.seek(time);
                  }
                  e.target.value = '';
                }}
              >
                <option value="" disabled>Jump to Section</option>
                {sections.map((s, i) => (
                  <option key={i} value={s.time}>{s.label || `Section ${i + 1}`}</option>
                ))}
              </select>
            );
          })()}
        </div>
        )}
      </div>

      {/* Mobile: transport buttons (row 2) */}
      <div className="flex items-center justify-center gap-2 mt-2 md:hidden">
        <PlayPauseButton size="lg" longPressStops />
        {!minimal && <LoopButton size="lg" verb="Tap" />}
        {/* Mobile controls toggle — shows/hides mixer + volume/speed sliders below lyrics */}
        {minimal !== 'lyrics' && <button
          className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
            showSliders ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          onClick={onToggleSliders}
          title="Mixer & Sliders"
          aria-label="Mixer and sliders"
          aria-pressed={showSliders}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="2" y1="14" x2="6" y2="14" />
            <line x1="12" y1="21" x2="12" y2="8" /><line x1="12" y1="4" x2="12" y2="3" /><line x1="10" y1="8" x2="14" y2="8" />
            <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="18" y1="16" x2="22" y2="16" />
          </svg>
        </button>}

        {/* Mobile sheet music: opens it full screen (only when the song has a score) */}
        {!minimal && hasSheetMusic && <button
          className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
            sheetMusicOpen ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          onClick={openSheetMusic}
          title="Sheet music"
          aria-label="Sheet music"
          aria-pressed={sheetMusicOpen}
        >
          <SheetMusicIcon />
        </button>}

        {/* Mobile bookmark toggle */}
        {!minimal && <button
          className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
            showBookmark ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          onClick={() => setShowBookmark(!showBookmark)}
          title="Position & Sections"
          aria-label="Position and sections"
          aria-pressed={showBookmark}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>}

        {/* Mobile lyrics toggle — only when song has lyrics */}
        {!minimal && hasLyrics && <button
          className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
            lyricsMobileVisible ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          onClick={toggleLyricsMobileVisible}
          title="Lyrics"
          aria-label="Lyrics"
          aria-pressed={lyricsMobileVisible}
        >
          <svg className="w-5 h-5" viewBox="0 0 512 512" fill="currentColor">
            <rect x="19.564" y="447.635" transform="matrix(-0.7071 -0.7071 0.7071 -0.7071 -285.559 842.3594)" width="24.231" height="65.371" />
            <polygon points="0.17,494.699 46.394,448.809 63.188,465.945 17.133,511.66" />
            <path d="M43.642,412.297l220.223-264.551l100.371,100.738L99.549,468.203L43.642,412.297z" />
            <path d="M391.48,238.551l-118.1-118.199c-0.279-30.238,11.02-59.379,31.887-81.891l168.268,168.614c-22.131,20.18-50.791,31.484-80.695,31.484L391.48,238.551z" />
            <path d="M330.783,17.23c18.611-10.984,40.072-16.992,62.018-16.992c31.787,0,61.664,12.371,84.127,34.832c38.895,38.898,46.123,98.863,17.625,145.93L330.783,17.23z" />
          </svg>
        </button>}
      </div>

      {/* Mobile: collapsible volume + speed sliders */}
      {showSliders && (
        <MasterSliders className="mt-2 md:hidden" />
      )}

      {/* Mobile: bookmark panel (position, measure/beat, section jump) */}
      {showBookmark && !minimal && (
        <div className="mt-2 md:hidden flex items-center justify-center gap-4">
          <div className="font-mono text-sm text-gray-300">
            {editingTime ? (
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={formatTimeInput(timeEditValue)}
                onChange={(e) => setTimeEditValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onBlur={() => {
                  setEditingTime(false);
                  const t = parseTimeDigits(timeEditValue);
                  if (t !== null && t >= 0 && t <= duration) engine.seek(t);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { setEditingTime(false); const t = parseTimeDigits(timeEditValue); if (t !== null && t >= 0 && t <= duration) engine.seek(t); }
                  if (e.key === 'Escape') setEditingTime(false);
                }}
                className="w-[5ch] text-sm text-center bg-gray-700 border border-gray-500 rounded px-0.5 outline-none focus:border-blue-500 text-gray-300 font-mono"
              />
            ) : (
              <button
                onClick={() => { if (playing) engine.pause(); setTimeEditValue(''); setEditingTime(true); }}
                className="hover:text-white cursor-text"
              >{formatTime(position)}</button>
            )}
            <span> / {formatTime(duration)}</span>
          </div>
          {(() => {
            const hasTapMap = selectedSong?.tapMap && selectedSong.tapMap.length > 0;
            if (!hasTapMap) return null;
            const mb = measureBeatAt(selectedSong?.tapMap, position);
            const measure = mb?.measure ?? 0;
            const beat = mb?.beat ?? 0;
            const startMeasureEdit = () => {
              if (playing) engine.pause();
              setMeasureEditValue(String(measure));
              setEditingMeasure(true);
            };
            const commitMeasure = () => {
              setEditingMeasure(false);
              const num = parseInt(measureEditValue, 10);
              if (!isNaN(num) && num > 0) {
                const t = measureBeatToTime(selectedSong?.tapMap, num, 1);
                if (t !== null) engine.seek(t);
              }
            };
            const startBeatEdit = () => {
              if (playing) engine.pause();
              setBeatEditValue(String(beat));
              setEditingBeat(true);
            };
            const commitBeat = () => {
              setEditingBeat(false);
              const num = parseInt(beatEditValue, 10);
              if (!isNaN(num) && num > 0) {
                const t = measureBeatToTime(selectedSong?.tapMap, measure || 1, num);
                if (t !== null) engine.seek(t);
              }
            };
            return (
              <div className="font-mono text-sm text-gray-500 flex items-center">
                {editingMeasure ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={measureEditValue}
                    onChange={(e) => setMeasureEditValue(e.target.value)}
                    onBlur={commitMeasure}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitMeasure(); if (e.key === 'Escape') setEditingMeasure(false); }}
                    className="w-[3ch] text-sm text-right bg-gray-700 border border-gray-500 rounded px-0.5 outline-none focus:border-blue-500 text-gray-300 font-mono"
                  />
                ) : (
                  <button onClick={startMeasureEdit} className="inline-block w-[2.5ch] text-right hover:text-gray-300 cursor-text">{measure}</button>
                )}
                <span className="text-gray-600 mx-0.5">|</span>
                {editingBeat ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={beatEditValue}
                    onChange={(e) => setBeatEditValue(e.target.value)}
                    onBlur={commitBeat}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitBeat(); if (e.key === 'Escape') setEditingBeat(false); }}
                    className="w-[2ch] text-sm bg-gray-700 border border-gray-500 rounded px-0.5 outline-none focus:border-blue-500 text-gray-300 font-mono"
                  />
                ) : (
                  <button onClick={startBeatEdit} className="inline-block w-[1.5ch] hover:text-gray-300 cursor-text">{beat}</button>
                )}
              </div>
            );
          })()}
          {(() => {
            const sections = selectedSong?.tapMap?.filter((e) => e.type === 'section');
            if (!sections || sections.length === 0) return null;
            return (
              <select
                className="text-xs bg-gray-700 border border-gray-600 rounded px-1 py-1.5 min-h-[44px] text-gray-400 cursor-pointer outline-none focus:border-blue-500 font-sans"
                value=""
                onChange={(e) => {
                  const time = parseFloat(e.target.value);
                  if (!isNaN(time)) {
                    if (playing) engine.pause();
                    engine.seek(time);
                  }
                  e.target.value = '';
                }}
              >
                <option value="" disabled>Jump to Section</option>
                {sections.map((s, i) => (
                  <option key={i} value={s.time}>{s.label || `Section ${i + 1}`}</option>
                ))}
              </select>
            );
          })()}
        </div>
      )}

    </div>
  );
}

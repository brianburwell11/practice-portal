import { useEffect, useState, useCallback } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useMixerStore } from '../../store/mixerStore';
import { useLyricsStore } from '../../store/lyricsStore';
import { useLongPress } from '../../hooks/useLongPress';
import { WaveformTimeline } from './WaveformTimeline';
import { TempoControl } from './TempoControl';
import { TouchSlider } from '../ui/TouchSlider';

import type { TapMapEntry } from '../../audio/types';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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

function getMeasureBeat(tapMap: TapMapEntry[] | undefined, position: number): { measure: number; beat: number } | null {
  if (!tapMap || tapMap.length === 0) return null;
  let measure = 0;
  let beat = 0;
  for (const entry of tapMap) {
    if (entry.time > position) break;
    if (entry.type === 'section' || entry.type === 'measure') {
      measure++;
      beat = 1;
    } else {
      beat++;
    }
  }
  return measure > 0 ? { measure, beat } : null;
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

const isIOS = typeof navigator !== 'undefined' && (
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);

const MUTE_BANNER_KEY = 'pp-mute-banner-dismissed';

export function TransportBar() {
  const engine = useAudioEngine();
  const { playing, position, duration, loopA, loopB, loopEnabled, toggleFollowPlayhead } = useTransportStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const stemLoading = useSongStore((s) => s.loading);
  const loadProgress = useSongStore((s) => s.loadProgress);
  const { masterVolume, setMasterVolume } = useMixerStore();
  const mixerStems = useMixerStore((s) => s.stems);
  const globalSoloActive = useMixerStore((s) => s.globalSoloActive);
  const globalMuteActive = useMixerStore((s) => s.globalMuteActive);
  const toggleGlobalSolo = useMixerStore((s) => s.toggleGlobalSolo);
  const toggleGlobalMute = useMixerStore((s) => s.toggleGlobalMute);
  const clearSoloGroup = useMixerStore((s) => s.clearSoloGroup);
  const clearMuteGroup = useMixerStore((s) => s.clearMuteGroup);

  const disabled = !selectedSong;
  const [volEditing, setVolEditing] = useState(false);
  const [volEditValue, setVolEditValue] = useState('');
  const [showSliders, setShowSliders] = useState(false);
  const [showBookmark, setShowBookmark] = useState(false);
  const lyricsMobileVisible = useLyricsStore((s) => s.mobileVisible);
  const toggleLyricsMobileVisible = useLyricsStore((s) => s.toggleMobileVisible);
  const [editingMeasure, setEditingMeasure] = useState(false);
  const [editingBeat, setEditingBeat] = useState(false);
  const [measureEditValue, setMeasureEditValue] = useState('');
  const [beatEditValue, setBeatEditValue] = useState('');
  const [editingTime, setEditingTime] = useState(false);
  const [timeEditValue, setTimeEditValue] = useState('');
  const [showMuteBanner, setShowMuteBanner] = useState(false);
  const [muteBannerDismissed, setMuteBannerDismissed] = useState(() => {
    try { return localStorage.getItem(MUTE_BANNER_KEY) === '1'; } catch { return false; }
  });

  // Show mute banner on first play on iOS
  useEffect(() => {
    if (isIOS && playing && !muteBannerDismissed) {
      setShowMuteBanner(true);
    }
  }, [playing, muteBannerDismissed]);

  const dismissMuteBanner = () => {
    setShowMuteBanner(false);
    setMuteBannerDismissed(true);
    try { localStorage.setItem(MUTE_BANNER_KEY, '1'); } catch {}
  };

  const handleMasterVolume = (v: number) => {
    const clamped = Math.max(0, Math.min(1.5, v));
    setMasterVolume(clamped);
    engine.setMasterVolume(clamped);
  };

  const commitVolEdit = () => {
    const parsed = parseInt(volEditValue, 10);
    if (!isNaN(parsed)) {
      handleMasterVolume(parsed / 100);
    }
    setVolEditing(false);
  };

  const handleLoopTap = useCallback(() => {
    if (loopA !== null && loopB !== null) {
      engine.setLoopEnabled(!loopEnabled);
    } else if (loopA !== null) {
      engine.setLoop(loopA, position);
    } else {
      engine.setLoop(position, null);
    }
  }, [engine, loopA, loopB, loopEnabled, position]);

  const handleLoopDoubleTap = useCallback(() => {
    engine.clearLoop();
  }, [engine]);

  const loopHandlers = useLongPress(handleLoopTap, handleLoopDoubleTap);

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

  const slidersGrid = (
    <div className="grid grid-cols-[2rem_1fr_2.5rem] md:grid-cols-[2rem_6rem_2.5rem] gap-x-2 gap-y-0.5 items-center">
      <label className="text-xs text-gray-400 text-right">Vol</label>
      <TouchSlider
        min={0}
        max={1.5}
        step={0.01}
        value={masterVolume}
        onChange={handleMasterVolume}
        onDoubleClick={() => handleMasterVolume(1.0)}
        label="Master Volume"
      />
      {volEditing ? (
        <input
          type="text"
          autoFocus
          value={volEditValue}
          onChange={(e) => setVolEditValue(e.target.value)}
          onBlur={commitVolEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitVolEdit();
            if (e.key === 'Escape') setVolEditing(false);
          }}
          className="w-full text-xs text-gray-300 font-mono text-right bg-gray-700 border border-gray-500 rounded px-1 py-0.5 outline-none focus:border-blue-500"
        />
      ) : (
        <button
          onClick={() => {
            setVolEditValue(String(Math.round(masterVolume * 100)));
            setVolEditing(true);
          }}
          className="text-xs text-gray-300 font-mono text-right hover:text-white cursor-text"
        >
          {Math.round(masterVolume * 100)}%
        </button>
      )}

      <TempoControl />
    </div>
  );

  return (
    <div className="flex flex-col md:flex-row md:items-center md:gap-4 px-4 py-3 border-b border-gray-700">
      {showMuteBanner && (
        <div className="flex items-center gap-2 w-full mb-2 px-3 py-2 bg-yellow-500/15 border border-yellow-500/30 rounded-lg text-sm text-yellow-200">
          <span className="inline-flex items-center gap-0.5 shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
              <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
              <path d="M18 8a6 6 0 0 0-9.33-5" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            <span className="text-xs mx-0.5">&rarr;</span>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </span>
          <span className="flex-1">If you can't hear audio, check that your phone isn't on silent.</span>
          <button onClick={dismissMuteBanner} className="shrink-0 text-yellow-400 hover:text-yellow-200 text-lg leading-none">&times;</button>
        </div>
      )}
      {/* Desktop: controls cluster (buttons + sliders grouped together, shrink-0) */}
      <div className="hidden md:flex md:flex-col md:gap-1 md:shrink-0">
        {/* Transport buttons — centered over sliders */}
        <div className="flex items-center justify-center gap-2">
          <button
            className="w-10 h-10 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-lg transition-colors"
            disabled={disabled}
            onClick={() => engine.stop()}
            title="Stop"
          >
            &#9632;
          </button>
          <button
            className="w-10 h-10 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-lg transition-colors"
            disabled={disabled}
            onClick={() => (playing ? engine.pause() : engine.play())}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? '\u2759\u2759' : '\u25B6'}
          </button>
          <button
            className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              loopA !== null && loopB !== null
                ? loopEnabled
                  ? 'bg-yellow-500 hover:bg-yellow-400 text-gray-900'
                  : 'bg-yellow-500/40 hover:bg-yellow-500/50 text-yellow-200'
                : loopA !== null
                  ? 'bg-yellow-600 hover:bg-yellow-500 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
            disabled={disabled}
            {...loopHandlers}
            title={
              loopA !== null && loopB !== null
                ? loopEnabled
                  ? `Loop: ${formatTime(loopA)} – ${formatTime(loopB)} — click to toggle, long-press to clear`
                  : `Loop: ${formatTime(loopA)} – ${formatTime(loopB)} (disabled) — click to toggle, long-press to clear`
                : loopA !== null
                  ? `Loop in: ${formatTime(loopA)} — click to set out point`
                  : 'Set loop in point'
            }
          >
            &#x21BB;
          </button>
        </div>

        {/* Volume + Speed sliders */}
        {slidersGrid}
      </div>

      {/* Waveform + timestamp — full width on mobile (row 1), flex-1 on desktop */}
      <div className="md:flex-1 md:min-w-0 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          {stemLoading && loadProgress ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${Math.round((loadProgress.loaded / loadProgress.total) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 shrink-0">
                {loadProgress.loaded}/{loadProgress.total}
              </span>
            </div>
          ) : (
            <WaveformTimeline />
          )}
        </div>
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
            const mb = getMeasureBeat(selectedSong?.tapMap, position);
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
      </div>

      {/* Mobile: transport buttons (row 2) */}
      <div className="flex items-center justify-center gap-2 mt-2 md:hidden">
        <button
          className="w-12 h-12 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-lg transition-colors"
          disabled={disabled}
          onClick={() => engine.stop()}
          title="Stop"
        >
          &#9632;
        </button>
        <button
          className="w-12 h-12 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-lg transition-colors"
          disabled={disabled}
          onClick={() => (playing ? engine.pause() : engine.play())}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '\u2759\u2759' : '\u25B6'}
        </button>
        <button
          className={`w-12 h-12 rounded-lg flex items-center justify-center text-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            loopA !== null && loopB !== null
              ? loopEnabled
                ? 'bg-yellow-500 hover:bg-yellow-400 text-gray-900'
                : 'bg-yellow-500/40 hover:bg-yellow-500/50 text-yellow-200'
              : loopA !== null
                ? 'bg-yellow-600 hover:bg-yellow-500 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          disabled={disabled}
          {...loopHandlers}
          title={
            loopA !== null && loopB !== null
              ? loopEnabled
                ? `Loop: ${formatTime(loopA)} – ${formatTime(loopB)} — tap to toggle, long-press to clear`
                : `Loop: ${formatTime(loopA)} – ${formatTime(loopB)} (disabled) — tap to toggle, long-press to clear`
              : loopA !== null
                ? `Loop in: ${formatTime(loopA)} — tap to set out point`
                : 'Set loop in point'
          }
        >
          &#x21BB;
        </button>
        {/* Mobile slider toggle */}
        <button
          className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
            showSliders ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          onClick={() => setShowSliders(!showSliders)}
          title="Volume & Speed"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="2" y1="14" x2="6" y2="14" />
            <line x1="12" y1="21" x2="12" y2="8" /><line x1="12" y1="4" x2="12" y2="3" /><line x1="10" y1="8" x2="14" y2="8" />
            <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="18" y1="16" x2="22" y2="16" />
          </svg>
        </button>

        {/* Mobile bookmark toggle */}
        <button
          className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
            showBookmark ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          onClick={() => setShowBookmark(!showBookmark)}
          title="Position & Sections"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        {/* Mobile lyrics toggle */}
        <button
          className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
            lyricsMobileVisible ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          onClick={toggleLyricsMobileVisible}
          title="Lyrics"
        >
          <svg className="w-5 h-5" viewBox="0 0 512 512" fill="currentColor">
            <rect x="19.564" y="447.635" transform="matrix(-0.7071 -0.7071 0.7071 -0.7071 -285.559 842.3594)" width="24.231" height="65.371" />
            <polygon points="0.17,494.699 46.394,448.809 63.188,465.945 17.133,511.66" />
            <path d="M43.642,412.297l220.223-264.551l100.371,100.738L99.549,468.203L43.642,412.297z" />
            <path d="M391.48,238.551l-118.1-118.199c-0.279-30.238,11.02-59.379,31.887-81.891l168.268,168.614c-22.131,20.18-50.791,31.484-80.695,31.484L391.48,238.551z" />
            <path d="M330.783,17.23c18.611-10.984,40.072-16.992,62.018-16.992c31.787,0,61.664,12.371,84.127,34.832c38.895,38.898,46.123,98.863,17.625,145.93L330.783,17.23z" />
          </svg>
        </button>
      </div>

      {/* Mobile: collapsible volume + speed sliders */}
      {showSliders && (
        <div className="mt-2 md:hidden">
          {slidersGrid}
        </div>
      )}

      {/* Mobile: bookmark panel (position, measure/beat, section jump) */}
      {showBookmark && (
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
            const mb = getMeasureBeat(selectedSong?.tapMap, position);
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

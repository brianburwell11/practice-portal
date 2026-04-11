import { useEffect, useState, useCallback } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useMixerStore } from '../../store/mixerStore';
import { useLongPress } from '../../hooks/useLongPress';
import { WaveformTimeline } from './WaveformTimeline';
import { TempoControl } from './TempoControl';
import { TouchSlider } from '../ui/TouchSlider';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
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
        {/* Transport buttons + timestamp */}
        <div className="flex items-center gap-2">
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
          <div className="font-mono text-sm text-gray-300 ml-1">
            {formatTime(position)} / {formatTime(duration)}
          </div>
        </div>

        {/* Volume + Speed sliders */}
        {slidersGrid}
      </div>

      {/* Waveform — full width on mobile (row 1), flex-1 on desktop */}
      <div className="md:flex-1 md:min-w-0">
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
        <div className="font-mono text-sm text-gray-300 ml-1">
          {formatTime(position)} / {formatTime(duration)}
        </div>

        {/* Mobile slider toggle */}
        <button
          className="w-12 h-12 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-lg transition-colors"
          onClick={() => setShowSliders(!showSliders)}
          title="Volume & Speed"
        >
          {showSliders ? '\u2715' : '\u266A'}
        </button>
      </div>

      {/* Mobile: collapsible volume + speed sliders (row 3) */}
      {showSliders && (
        <div className="mt-2 md:hidden">
          {slidersGrid}
        </div>
      )}

      {/* Song info — desktop only */}
      {selectedSong && (
        <div className="hidden md:block text-sm text-gray-400 shrink-0">
          <span className="text-gray-200">{selectedSong.title}</span>
          <span className="mx-1">—</span>
          <span>{selectedSong.artist}</span>
          {selectedSong.key && (
            <span className="ml-2 px-1.5 py-0.5 bg-gray-700 rounded text-xs">
              {selectedSong.key}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

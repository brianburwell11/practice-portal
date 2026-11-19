import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { MAX_LATENCY_ADJUST_MS, MIN_LATENCY_ADJUST_MS, useLatencyStore } from '../../store/latencyStore';
import {
  CALIBRATION_BPM, CALIBRATION_MAX_SECONDS, CALIBRATION_PERIOD, EARLY_LIMIT_MS,
  summarize, tapOffsetMs, type CalibrationSummary,
} from '../../audio/latencyCalibration';
import { Modal } from '../ui/Modal';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import practicePortalMark from '../../assets/practice-portal-mark-large.png';

/** Fewer counted taps than this and the result isn't worth saving */
const MIN_RESULT_TAPS = 6;
/** How far ahead clicks are scheduled, in seconds */
const LOOKAHEAD = 0.1;

const EMPTY: CalibrationSummary = { estimateMs: null, sdMs: null, count: 0, stable: false };

type Phase = 'idle' | 'running' | 'done';

/**
 * Audio latency, opened from the TapMap editor. Bluetooth headphones play
 * sound a few hundred milliseconds after the app sends it, so taps would land
 * early and the beat counter would run ahead of what you hear. The app shifts
 * both by the delay the browser reports, plus an adjustment. Start plays a
 * click; tapping along with it measures the real delay, and Save turns the
 * difference into the adjustment. Per device.
 */
export function AudioLatencyDialog({ onClose }: { onClose: () => void }) {
  const engine = useAudioEngine();
  const adjustMs = useLatencyStore((s) => s.adjustMs);
  const setAdjustMs = useLatencyStore((s) => s.setAdjustMs);
  const [detectedMs, setDetectedMs] = useState(() => Math.round(engine.detectedLatencySeconds * 1000));
  const readDetected = useCallback(
    () => setDetectedMs(Math.round(engine.detectedLatencySeconds * 1000)),
    [engine],
  );

  // The reported delay changes when headphones connect or disconnect, so
  // keep reading it; Refresh reads it on demand too.
  useEffect(() => {
    const id = setInterval(readDetected, 500);
    return () => clearInterval(id);
  }, [readDetected]);

  // Reading is instant, so Refresh shows a short running state and then the
  // result, to make it clear something happened.
  const [refresh, setRefresh] = useState<'idle' | 'running' | 'updated' | 'unchanged'>('idle');
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  const handleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    const before = Math.round(engine.detectedLatencySeconds * 1000);
    setRefresh('running');
    refreshTimer.current = setTimeout(() => {
      const after = Math.round(engine.detectedLatencySeconds * 1000);
      setDetectedMs(after);
      setRefresh(after === before ? 'unchanged' : 'updated');
      refreshTimer.current = setTimeout(() => setRefresh('idle'), 2000);
    }, 600);
  }, [engine]);

  // --- Tap-along calibration ---
  const [phase, setPhase] = useState<Phase>('idle');
  const [summary, setSummary] = useState<CalibrationSummary>(EMPTY);
  const [elapsed, setElapsed] = useState(0);
  const [saved, setSaved] = useState(false);
  const run = useRef<{
    firstClick: number;
    nextIndex: number;
    offsets: number[];
    clicks: { when: number; cancel: () => void }[];
    timer: ReturnType<typeof setInterval> | null;
  } | null>(null);
  const padRef = useRef<HTMLButtonElement>(null);
  const markRef = useRef<HTMLImageElement>(null);
  const coarse = useMediaQuery('(pointer: coarse)');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  /** A quick bounce and glow on the mark, so each tap visibly registers.
   *  Restarts on every tap, so fast taps never queue up. */
  const pulseMark = useCallback(() => {
    const glow = 'drop-shadow(0 0 14px var(--color-brand)) drop-shadow(0 0 4px var(--color-brand))';
    const rest = 'drop-shadow(0 0 0 transparent) drop-shadow(0 0 0 transparent)';
    markRef.current?.animate(
      reduceMotion
        ? [{ filter: rest }, { filter: glow, offset: 0.3 }, { filter: rest }]
        : [
            { transform: 'scale(1)', filter: rest },
            { transform: 'scale(1.12)', filter: glow, offset: 0.3 },
            { transform: 'scale(1)', filter: rest },
          ],
      { duration: 220, easing: 'ease-out' },
    );
  }, [reduceMotion]);

  /** Stop the click and the scheduler. Clicks already sounding finish. */
  const halt = useCallback(() => {
    const r = run.current;
    if (!r) return;
    if (r.timer) clearInterval(r.timer);
    r.timer = null;
    const now = engine.audioContext.currentTime;
    for (const c of r.clicks) if (c.when > now) c.cancel();
    r.clicks = [];
    engine.endCalibration();
  }, [engine]);

  const finish = useCallback(() => {
    halt();
    setPhase('done');
  }, [halt]);

  // Closing mid-run silences the click
  useEffect(() => () => halt(), [halt]);

  const start = useCallback(async () => {
    halt();
    setSummary(EMPTY);
    setElapsed(0);
    setSaved(false);
    // Synchronous part runs inside the tap, so iOS lets the output open
    await engine.beginCalibration();
    const ctx = engine.audioContext;
    const r = {
      firstClick: ctx.currentTime + 0.4,
      nextIndex: 0,
      offsets: [] as number[],
      clicks: [] as { when: number; cancel: () => void }[],
      timer: null as ReturnType<typeof setInterval> | null,
    };
    run.current = r;
    const tick = () => {
      const now = ctx.currentTime;
      const end = r.firstClick + CALIBRATION_MAX_SECONDS;
      while (true) {
        const when = r.firstClick + r.nextIndex * CALIBRATION_PERIOD;
        if (when > now + LOOKAHEAD || when >= end) break;
        r.clicks.push({ when, cancel: engine.scheduleClick(when, r.nextIndex % 4 === 0) });
        r.nextIndex++;
      }
      r.clicks = r.clicks.filter((c) => c.when > now - 0.1);
      setElapsed(Math.max(0, now - r.firstClick));
      if (now >= end) finish();
    };
    tick();
    r.timer = setInterval(tick, 25);
    setPhase('running');
  }, [engine, halt, finish]);

  // Focus the pad when a run starts, so Space and Enter tap
  useEffect(() => {
    if (phase === 'running') padRef.current?.focus();
  }, [phase]);

  const tap = useCallback((eventTimeStamp: number) => {
    const r = run.current;
    if (phase !== 'running' || !r?.timer) return;
    const ctx = engine.audioContext;
    // When the finger or key actually went down, not when the handler ran
    const lag = Math.max(0, performance.now() - eventTimeStamp) / 1000;
    const t = ctx.currentTime - lag;
    if (t < r.firstClick - EARLY_LIMIT_MS / 1000) return;
    pulseMark();
    r.offsets.push(tapOffsetMs(t, r.firstClick));
    const s = summarize(r.offsets);
    setSummary(s);
    if (s.stable) finish();
  }, [engine, phase, finish, pulseMark]);

  const measuredMs = summary.count >= MIN_RESULT_TAPS ? summary.estimateMs : null;
  const proposedAdjust = measuredMs === null
    ? null
    : Math.max(MIN_LATENCY_ADJUST_MS, Math.min(MAX_LATENCY_ADJUST_MS, measuredMs - detectedMs));

  const totalMs = Math.max(0, detectedMs + adjustMs);
  const signed = (ms: number) => `${ms > 0 ? '+' : ''}${ms} ms`;
  const progress = Math.min(1, elapsed / CALIBRATION_MAX_SECONDS);

  const primaryBtn = 'px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium text-accent-ink transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900';
  const secondaryBtn = 'px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900';

  return (
    <Modal onClose={onClose} title="Audio latency" showClose>
      <p className="text-sm text-gray-400">
        Bluetooth headphones play sound a little late. Your taps and the beat counter are shifted by the same amount so they match what you hear.
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-400 self-center">Detected</dt>
        <dd className="flex items-center gap-2 text-gray-200 tabular-nums">
          {detectedMs} ms
          <button
            onClick={handleRefresh}
            disabled={refresh === 'running'}
            aria-live="polite"
            className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded transition-all duration-150
              outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900
              active:scale-95 disabled:cursor-default ${
              refresh === 'updated' || refresh === 'unchanged'
                ? 'bg-green-900/40 text-green-400'
                : refresh === 'running'
                  ? 'bg-gray-700 text-gray-400'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-gray-100 active:bg-gray-500'
            }`}
            title="Read the delay again, after putting on or taking off headphones"
          >
            {refresh === 'running' ? (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
            ) : refresh === 'idle' ? (
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
            ) : (
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {refresh === 'running' ? 'Checking' : refresh === 'updated' ? 'Updated' : refresh === 'unchanged' ? 'No change' : 'Refresh'}
          </button>
        </dd>
        <dt className="text-gray-400">Adjustment</dt>
        <dd className="text-gray-200 tabular-nums">{signed(adjustMs)}</dd>
        <dt className="text-gray-400">Total</dt>
        <dd className="text-gray-100 font-medium tabular-nums">{totalMs} ms</dd>
      </dl>

      <section className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3" aria-label="Measure by tapping">
        {phase === 'idle' && (
          <>
            <p className="text-sm text-gray-300">
              To measure it, put on your headphones and press Start. A click plays at {CALIBRATION_BPM} BPM. Tap along with what you hear, for up to {CALIBRATION_MAX_SECONDS} seconds.
            </p>
            <button className={`${primaryBtn} w-full`} onClick={start}>Start</button>
          </>
        )}

        {phase === 'running' && (
          <>
            <button
              ref={padRef}
              onPointerDown={(e) => { e.preventDefault(); tap(e.timeStamp); }}
              onKeyDown={(e) => {
                if (e.key !== ' ' && e.key !== 'Enter') return;
                e.preventDefault();
                if (!e.repeat) tap(e.timeStamp);
              }}
              aria-label="Tap"
              className="w-full flex flex-col items-center justify-center gap-2 py-4 rounded-lg select-none touch-none
                outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900"
            >
              <img ref={markRef} src={practicePortalMark} alt="" draggable={false} className="h-24 w-auto pointer-events-none" />
              {!coarse && <span className="text-xs text-gray-400">Click or press Space</span>}
            </button>
            <div
              className="h-1.5 rounded-full bg-gray-700 overflow-hidden"
              role="progressbar"
              aria-label="Time left"
              aria-valuemin={0}
              aria-valuemax={CALIBRATION_MAX_SECONDS}
              aria-valuenow={Math.round(elapsed)}
            >
              <div className="h-full bg-gray-400" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400 tabular-nums" aria-live="polite">
                {summary.estimateMs === null
                  ? 'Tap along with the click'
                  : `${summary.estimateMs} ms, ${summary.sdMs !== null && summary.sdMs < 25 ? 'getting steady' : 'keep going'}`}
              </span>
              <button className="text-xs px-2 py-1 rounded text-gray-400 hover:text-gray-200" onClick={finish}>
                Stop
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            {measuredMs === null ? (
              <p className="text-sm text-gray-300">
                Not enough taps to measure. Try again and tap along with every click.
              </p>
            ) : (
              <p className="text-sm text-gray-300">
                Measured <span className="text-gray-100 font-medium tabular-nums">{measuredMs} ms</span>
                {' '}(detected {detectedMs} ms{summary.sdMs !== null ? `, give or take ${summary.sdMs} ms` : ''}).
                {saved ? ' Saved.' : ''}
              </p>
            )}
            <div className="flex gap-2">
              {proposedAdjust !== null && !saved && (
                <button
                  className={`${primaryBtn} flex-1`}
                  onClick={() => { setAdjustMs(proposedAdjust); setSaved(true); }}
                >
                  Save
                </button>
              )}
              <button className={`${proposedAdjust !== null && !saved ? secondaryBtn : primaryBtn} flex-1`} onClick={start}>
                Try again
              </button>
            </div>
          </>
        )}
      </section>

      <div className="space-y-1">
        <label htmlFor="audio-latency-adjust" className="block text-sm text-gray-300">Fine tune</label>
        <div className="flex items-center gap-3">
          <input
            id="audio-latency-adjust"
            type="range"
            min={MIN_LATENCY_ADJUST_MS}
            max={MAX_LATENCY_ADJUST_MS}
            step={5}
            value={adjustMs}
            onChange={(e) => setAdjustMs(Number(e.target.value))}
            className="flex-1"
          />
          <button
            onClick={() => setAdjustMs(0)}
            disabled={adjustMs === 0}
            className="text-xs px-2 py-1 rounded text-gray-400 hover:text-gray-200 disabled:text-gray-700 disabled:cursor-default"
          >
            Reset
          </button>
        </div>
        <p className="text-xs text-gray-500">
          If the beat counter still runs early, move the slider right. If it runs late, move it left. Saved on this device only.
        </p>
      </div>
    </Modal>
  );
}

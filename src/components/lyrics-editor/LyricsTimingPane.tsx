import { useCallback, useEffect, useRef } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useTransportStore } from '../../store/transportStore';
import { useLyricsEditorStore, nextNonBlankIndex } from '../../store/lyricsEditorStore';
import { isSectionMarker, isInstrumentalAnnotation, isEndMarker } from '../../audio/lyricSections';
import { TapPadButton } from '../ui/TapPadButton';

const NUDGE = 0.1;
/** Replay starts this many seconds before the line. */
const REPLAY_LEAD = 1;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatPrecise(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

/**
 * Timing mode: stamp each line as it starts (Tab, or the big Next line
 * pad on touch), step back to redo one, and fine-tune the selected line
 * with nudges and a replay. The karaoke track above previews the result.
 */
export function LyricsTimingPane() {
  const engine = useAudioEngine();
  const position = useTransportStore((s) => s.position);
  const playing = useTransportStore((s) => s.playing);
  const coarse = useMediaQuery('(pointer: coarse)');
  const {
    lines, currentSyncIndex, reviewIndex,
    syncLine, cueEnd, stepBack, nudgeLine, selectLine, undo, redo,
  } = useLyricsEditorStore();

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Read the engine clock directly so the stamp matches the keypress or
  // finger-down, not the last UI tick.
  // Past the last line with no end marker yet, the same control adds one.
  const hasEnd = lines.some((l) => isEndMarker(l.text));
  const stampNext = useCallback(() => {
    if (currentSyncIndex < lines.length) syncLine(currentSyncIndex, engine.clock.currentTime);
    else if (!hasEnd && lines.length > 0) cueEnd(engine.clock.currentTime);
  }, [currentSyncIndex, lines.length, hasEnd, syncLine, cueEnd, engine]);

  const reviewLine = reviewIndex !== null ? lines[reviewIndex] : undefined;
  const reviewTime = reviewLine?.time ?? null;

  const nudge = useCallback((delta: number) => {
    if (reviewIndex !== null) nudgeLine(reviewIndex, delta);
  }, [reviewIndex, nudgeLine]);

  const replay = useCallback(() => {
    if (reviewTime === null) return;
    engine.seek(Math.max(0, reviewTime - REPLAY_LEAD));
    if (!playing) engine.play();
  }, [reviewTime, engine, playing]);

  // Keys. Space (play/pause) is handled by the transport bar.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) stepBack(); else stampNext();
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        nudge(e.key === 'ArrowLeft' ? -NUDGE : NUDGE);
      } else if (!mod && !e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        replay();
      } else if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stampNext, stepBack, nudge, replay, undo, redo]);

  // Keep the next line to stamp in view.
  useEffect(() => {
    rowRefs.current[currentSyncIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentSyncIndex]);

  const stampableIdx = lines.map((_, i) => nextNonBlankIndex(lines, i) === i);
  const counted = lines.filter((l, i) => stampableIdx[i] && !isEndMarker(l.text));
  const total = counted.length;
  const synced = counted.filter((l) => l.time !== null).length;
  const pastLast = currentSyncIndex >= lines.length;
  const canCueEnd = pastLast && !hasEnd && lines.length > 0;
  const done = pastLast && !canCueEnd;
  const next = lines[currentSyncIndex];
  const cueingEnd = canCueEnd || (!!next && isEndMarker(next.text));
  const nextLabel = canCueEnd
    ? 'Optional: clears the lyrics after the last line'
    : !next
      ? undefined
      : isEndMarker(next.text)
        ? 'Clears the lyrics after the last line'
        : next.instrumental || isInstrumentalAnnotation(next.text)
          ? '🎶 Instrumental'
          : next.text.trim();
  const cueLabel = done ? 'All lines synced' : cueingEnd ? 'Cue end of lyrics' : 'Cue next line';

  const btn = 'rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-gray-300 transition-colors';
  const status = (
    <span className="text-xs text-gray-500 whitespace-nowrap">
      {reviewTime !== null && <>Line {reviewIndex! + 1} at <span className="font-mono text-gray-300">{formatPrecise(reviewTime)}</span>, </>}
      {synced}/{total} synced
    </span>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-[7rem] overflow-y-auto max-w-2xl w-full mx-auto rounded-lg border border-gray-700">
        {lines.length === 0 && (
          <p className="p-4 text-sm text-gray-500">No lyrics yet. Switch to Lyrics to add them.</p>
        )}
        {lines.map((line, i) => {
          const isTarget = i === currentSyncIndex;
          const isReview = i === reviewIndex;
          const isSection = !line.instrumental && (isSectionMarker(line.text) || isInstrumentalAnnotation(line.text));
          const isBlank = !line.instrumental && line.text === '';
          const isEnd = isEndMarker(line.text);
          return (
            <div
              key={i}
              ref={(el) => { rowRefs.current[i] = el; }}
              onClick={() => {
                if (!stampableIdx[i]) return;
                selectLine(i);
                if (line.time !== null) engine.seek(line.time);
              }}
              className={`flex items-center gap-2 px-3 ${isBlank ? 'h-3' : 'py-2 md:py-1.5'} border-l-2 transition-colors ${
                stampableIdx[i] ? 'cursor-pointer' : ''
              } ${
                isTarget
                  ? 'bg-blue-900/30 border-blue-400'
                  : isReview
                    ? 'bg-gray-800/60 border-yellow-500/70'
                    : 'border-transparent hover:bg-gray-800/30'
              }`}
            >
              {!isBlank && (
                <>
                  <span className="w-6 text-right text-xs font-mono shrink-0 text-gray-600">{i + 1}</span>
                  <span
                    className={`flex-1 min-w-0 truncate text-base md:text-sm ${
                      line.instrumental || isEnd
                        ? 'italic text-gray-500'
                        : isSection
                          ? 'font-mono font-semibold text-purple-300 uppercase tracking-wide'
                          : 'text-gray-200'
                    }`}
                  >
                    {line.instrumental ? '🎶' : isEnd ? 'End of lyrics' : line.text}
                  </span>
                  {stampableIdx[i] && (
                    <span className="w-14 shrink-0 text-right text-xs font-mono">
                      {isTarget && line.time === null ? (
                        <span className="text-white">{formatTime(position)}</span>
                      ) : line.time !== null ? (
                        <span className={isReview ? 'text-yellow-300' : 'text-green-400'}>{formatTime(line.time)}</span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 max-w-2xl w-full mx-auto px-3 md:px-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
        {coarse ? (
          <>
            <TapPadButton
              label={cueLabel}
              sublabel={nextLabel}
              color="bg-cyan-500 text-gray-900"
              onFire={stampNext}
              disabled={done}
            />
            <div className="grid grid-cols-4 gap-2">
              <button className={`${btn} py-2.5`} onClick={stepBack} disabled={currentSyncIndex === 0}>
                Back a line
              </button>
              <button className={`${btn} py-2.5`} onClick={() => nudge(-NUDGE)} disabled={reviewTime === null}>
                −0.1s
              </button>
              <button className={`${btn} py-2.5`} onClick={() => nudge(NUDGE)} disabled={reviewTime === null}>
                +0.1s
              </button>
              <button className={`${btn} py-2.5`} onClick={replay} disabled={reviewTime === null}>
                Replay
              </button>
            </div>
            <div className="text-center">{status}</div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="px-4 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-gray-900 transition-colors max-w-[16rem] truncate"
              onClick={stampNext}
              disabled={done}
              title="Stamp the highlighted line at the playhead (Tab)"
            >
              {cueLabel}
            </button>
            <button className={`${btn} px-3 py-1.5`} onClick={stepBack} disabled={currentSyncIndex === 0} title="Shift+Tab">
              Back a line
            </button>
            <button className={`${btn} px-3 py-1.5`} onClick={() => nudge(-NUDGE)} disabled={reviewTime === null} title="Alt+←">
              −0.1s
            </button>
            <button className={`${btn} px-3 py-1.5`} onClick={() => nudge(NUDGE)} disabled={reviewTime === null} title="Alt+→">
              +0.1s
            </button>
            <button className={`${btn} px-3 py-1.5`} onClick={replay} disabled={reviewTime === null} title="R">
              Replay
            </button>
            <span className="ml-auto">{status}</span>
          </div>
        )}
      </div>

      {!coarse && (
        <div className="mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-2 text-[10px] text-gray-600 border-t border-gray-700">
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Space</kbd> play/pause</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Tab</kbd> cue next line</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⇧Tab</kbd> back a line</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌥←→</kbd> nudge</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">R</kbd> replay</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">click</kbd> select line</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘Z</kbd> undo</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘⇧Z</kbd> redo</span>
        </div>
      )}
    </div>
  );
}

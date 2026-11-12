import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWakeLock } from '../../../hooks/useWakeLock';
import { useSheetMusicStore } from '../../../store/sheetMusicStore';
import { useTransportStore } from '../../../store/transportStore';
import { CompactTransport } from '../../transport/CompactTransport';
import type { PartInfo } from '../EngravedStripRenderer';
import { PartsMenu } from '../PartsMenu';
import { PageScoreView, type PageLayoutMode } from './PageScoreView';
import type { SongScoreFiles } from './museEncoreEngine';

interface Props {
  title: string;
  files: SongScoreFiles;
  parts: PartInfo[];
  hiddenPartIds: ReadonlySet<string>;
  onHiddenPartIdsChange: (hidden: Set<string>) => void;
  /** The score's parts as the page view finds them (on phones the strip isn't there to). */
  onParts?: (parts: PartInfo[]) => void;
  repeatAfterDcDs: boolean;
  onClose: () => void;
}

const LAYOUTS: { value: PageLayoutMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'page', label: 'Pages' },
  { value: 'fit-width', label: 'Fit to width' },
];

const isTouchScreen = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Sheet music full screen: the page view, with a compact transport (play,
 * loop, a short waveform) docked at the bottom so playback stays in reach.
 *
 * Key presses aren't swallowed, so the player's shortcuts (space, loop keys)
 * still work while it's open; Escape closes it.
 */
export function ScoreFullView({ title, files, parts, hiddenPartIds, onHiddenPartIdsChange, onParts, repeatAfterDcDs, onClose }: Props) {
  const [layout, setLayout] = useState<PageLayoutMode>('auto');
  const [touch] = useState(isTouchScreen);
  const zoom = useSheetMusicStore((s) => s.pageZoom);
  const setZoom = useSheetMusicStore((s) => s.setPageZoom);
  const invert = useSheetMusicStore((s) => s.pageInvert);
  const setInvert = useSheetMusicStore((s) => s.setPageInvert);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Keep the screen on while playing (a phone on a music stand).
  useWakeLock(useTransportStore((s) => s.playing));

  // Escape closes (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus moves in on open and stays inside while it's open.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.focus();
    const onFocusIn = (e: FocusEvent) => {
      if (!dialog.contains(e.target as Node)) dialog.focus();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const btn = 'rounded px-2 py-1 bg-gray-800 text-gray-200 hover:bg-gray-700';

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Sheet music: ${title}`}
      tabIndex={-1}
      className="fixed inset-0 z-[90] flex flex-col bg-gray-950 text-sm text-gray-200 outline-none"
    >
      <div
        className="flex flex-wrap items-center gap-2 border-b border-gray-800 px-3 py-1.5"
        style={{ paddingTop: 'max(0.375rem, env(safe-area-inset-top))' }}
      >
        <h2 className="mr-auto min-w-0 truncate font-medium text-gray-100">{title}</h2>
        <label className="flex items-center gap-1 text-xs text-gray-400">
          <span className="sr-only sm:not-sr-only">Layout</span>
          <select
            className="rounded bg-gray-800 px-1.5 py-1 text-gray-200"
            value={layout}
            onChange={(e) => setLayout(e.target.value as PageLayoutMode)}
          >
            {LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button className={btn} onClick={() => setZoom(zoom / 1.15)} aria-label="Zoom out">−</button>
          <button className={`${btn} w-14 tabular-nums`} onClick={() => setZoom(1)} title="Fit">{Math.round(zoom * 100)}%</button>
          <button className={btn} onClick={() => setZoom(zoom * 1.15)} aria-label="Zoom in">+</button>
        </div>
        <button
          className={`${btn} ${invert ? 'bg-blue-600 text-accent-ink hover:bg-blue-500' : ''}`}
          onClick={() => setInvert(!invert)}
          aria-pressed={invert}
          title="Light notes on dark pages"
        >
          Dark pages
        </button>
        <PartsMenu parts={parts} hiddenPartIds={hiddenPartIds} onApply={onHiddenPartIdsChange} className="py-1" />
        <button
          className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
          onClick={onClose}
          aria-label="Close full screen sheet music"
          title="Close (Esc)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <PageScoreView files={files} hiddenPartIds={hiddenPartIds} onParts={onParts} repeatAfterDcDs={repeatAfterDcDs} layoutMode={layout} />
      </div>

      <div
        className="border-t border-gray-800 bg-gray-900"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      >
        <CompactTransport touch={touch} />
      </div>
    </div>,
    document.body,
  );
}

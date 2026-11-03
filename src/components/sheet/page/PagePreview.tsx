/**
 * TEMPORARY (dev builds only): hosts `PageScoreView` in a panel over the
 * bottom of the screen, leaving the transport and waveform at the top usable,
 * so the page view can be tried before the real full-screen overlay (Phase 5)
 * exists.
 */
import { useState } from 'react';
import { useSheetMusicStore } from '../../../store/sheetMusicStore';
import { PageScoreView, type PageLayoutMode } from './PageScoreView';
import type { SongScoreFiles } from './museEncoreEngine';

interface Props {
  files: SongScoreFiles;
  songId: string;
  repeatAfterDcDs: boolean;
  onClose: () => void;
}

export function PagePreview({ files, songId, repeatAfterDcDs, onClose }: Props) {
  const [mode, setMode] = useState<PageLayoutMode>('auto');
  const zoom = useSheetMusicStore((s) => s.pageZoom);
  const setZoom = useSheetMusicStore((s) => s.setPageZoom);
  const invert = useSheetMusicStore((s) => s.pageInvert);
  const setInvert = useSheetMusicStore((s) => s.setPageInvert);
  const btn = 'rounded bg-gray-800 px-2 py-0.5 hover:bg-gray-700';

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex h-[70vh] flex-col border-t border-gray-700 bg-gray-900 text-xs text-gray-200 shadow-2xl">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        <strong className="text-sm">Page view (preview)</strong>
        <select className="rounded bg-gray-800 px-1 py-0.5" value={mode} onChange={(e) => setMode(e.target.value as PageLayoutMode)}>
          <option value="auto">auto</option>
          <option value="page">exact pages</option>
          <option value="fit-width">reflow to width</option>
        </select>
        <button className={btn} onClick={() => setZoom(zoom / 1.15)} aria-label="Zoom out">−</button>
        <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
        <button className={btn} onClick={() => setZoom(zoom * 1.15)} aria-label="Zoom in">+</button>
        <button className={btn} onClick={() => setZoom(1)}>fit</button>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
          invert
        </label>
        <button className={`${btn} ml-auto`} onClick={onClose}>close</button>
      </div>
      <div className="min-h-0 flex-1">
        <PageScoreView files={files} songId={songId} repeatAfterDcDs={repeatAfterDcDs} layoutMode={mode} />
      </div>
    </div>
  );
}

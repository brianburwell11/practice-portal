import { MSCZ_FILENAME, SCORE_FILENAME } from '../../config/schema';
import { usePanelMinimizeStore } from '../../store/panelMinimizeStore';
import { r2Url } from '../../utils/url';
import type { SongScoreFiles } from './page/museEncoreEngine';

/**
 * Where a song's score files are: the MusicXML (`sheetMusicUrl`) and, when
 * the song keeps one, the original MuseScore file, which is what gets drawn.
 * Only bare filenames in the song's own folder are accepted (see
 * `SCORE_FILENAME`), so a song config can't point the player elsewhere.
 * Null when the song has no (valid) score.
 *
 * Kept free of the sheet music engine, so song loading can use it to warm
 * the cache without pulling the engine into the main bundle.
 */
export function songScoreFiles(
  bandId: string | undefined,
  song: {
    id: string;
    sheetMusicUrl?: string;
    sheetMusicMsczUrl?: string;
    sheetMusicModified?: string;
    mediaVersions?: Record<string, string>;
  } | null | undefined,
): SongScoreFiles | null {
  const mxl = song?.sheetMusicUrl;
  if (!bandId || !song || !mxl || !SCORE_FILENAME.test(mxl)) return null;
  const mscz = song.sheetMusicMsczUrl;
  // `?v=` is the file's content version (see `mediaVersions`): the offline
  // cache keeps the file under it.
  const url = (file: string) => {
    const v = song.mediaVersions?.[file];
    return r2Url(`${bandId}/songs/${song.id}/${file}`) + (v ? `?v=${encodeURIComponent(v)}` : '');
  };
  return {
    mxlUrl: url(mxl),
    msczUrl: mscz && MSCZ_FILENAME.test(mscz) ? url(mscz) : undefined,
    modified: song.sheetMusicModified,
  };
}

/**
 * Starts a song's score downloading while its audio loads, so the score
 * view doesn't wait for it afterwards: the score files go into the HTTP
 * cache, and on desktop (where the strip shows straight away, unless it's
 * minimized) the sheet music engine and its fonts start loading too. Phones
 * only load the engine when sheet music is opened. Never throws.
 */
export function warmSongScore(bandId: string | undefined, song: Parameters<typeof songScoreFiles>[1]): void {
  const files = songScoreFiles(bandId, song);
  if (!files) return;
  for (const url of [files.mxlUrl, files.msczUrl]) {
    if (url) void fetch(url).catch(() => undefined);
  }
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
  const minimized = usePanelMinimizeStore.getState().items.some((x) => x.kind === 'panel' && x.id === 'sheet');
  if (wide && !minimized) {
    void import('./page/museEncoreEngine').then((m) => m.preloadScoreEngine()).catch(() => undefined);
  }
}

import { useRef, useState } from 'react';
import type { SongConfig, TapMapEntry } from '../audio/types';
import { buildMusicXmlContent } from '../audio/musicXmlExporter';
import { useSongStore } from '../store/songStore';
import { canonicalSheetMusicName, SHEET_MUSIC_ACCEPT } from './utils/sheetMusic';

/** A score to open in the editor for a song that has none yet. */
export interface NewScore {
  /** The file name; its extension says what it is (`.mscz`, `.mxl`, `.musicxml`, `.xml`). */
  name: string;
  data: ArrayBuffer;
  /** The `.mxl` name Save stores it under. */
  saveAs: string;
}

/** Measures the beat map would make into a score: each measure or section mark starts one. */
function beatMapMeasures(tapMap: TapMapEntry[] | undefined): number {
  return tapMap?.filter((e) => e.type === 'measure' || e.type === 'section').length ?? 0;
}

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}

/** Five staff lines with bar lines: a score laid out from the beat map's measures. */
function StaffIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M2 6h20M2 9.5h20M2 13h20M2 16.5h20M2 20h20" opacity="0.55" />
      <path d="M2 6v14M9 6v14M16 6v14M22 6v14" strokeWidth="2" />
    </svg>
  );
}

interface Props {
  song: SongConfig;
  /** A score was chosen: open it in the full screen editor. */
  onOpen: (score: NewScore) => void;
  onClose: () => void;
}

/**
 * The Sheet Music Editor for a song with no sheet music yet, in the page's
 * editor slot like the beat map, lyrics and chords editors: upload a MusicXML
 * or MuseScore file, or make a score from the beat map (the same MusicXML as
 * the Beat Map Editor's export). Either one opens full screen in
 * ScoreEditorPanel, where Save makes it the song's sheet music.
 */
export function ScoreStartPanel({ song, onOpen, onClose }: Props) {
  const tapMap = useSongStore((s) => (s.selectedSong?.id === song.id ? s.selectedSong.tapMap : song.tapMap));
  const measureCount = beatMapMeasures(tapMap);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const saveAs = canonicalSheetMusicName(file);
    if (!saveAs) {
      setError('That isn’t a MusicXML or MuseScore file. Use .musicxml, .xml, .mxl or .mscz.');
      return;
    }
    setError(null);
    onOpen({ name: file.name, data: await file.arrayBuffer(), saveAs });
  };

  const fromBeatMap = () => {
    const title = song.title.trim() || 'Score';
    const name = `${title.replace(/[\\/:*?"<>|]/g, '_')}.musicxml`;
    const bytes = new TextEncoder().encode(buildMusicXmlContent(tapMap ?? [], { title }));
    onOpen({ name, data: bytes.buffer as ArrayBuffer, saveAs: canonicalSheetMusicName(new File([], name)) ?? 'score.mxl' });
  };

  const btn = 'px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors';
  const tile = 'group flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-colors';

  return (
    <div className="editor-slot flex-1 flex flex-col min-h-0">
      {/* Toolbar: the same layout as the other on-page editors (centered
          title, no song name: the header above shows it). */}
      <div className="relative flex items-center justify-end gap-2 px-3 md:px-5 py-2">
        <h2 className="absolute inset-0 hidden md:flex items-center justify-center text-sm font-semibold text-gray-100 pointer-events-none">
          Edit Sheet Music
        </h2>
        <button className={`${btn} relative z-10`} onClick={onClose}>
          Close
        </button>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto px-4 py-6 md:py-10"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files[0]);
        }}
      >
        <div className="mx-auto max-w-2xl space-y-8">
          <div className="space-y-2">
            <h3 className="text-2xl font-semibold text-gray-100 text-balance">{song.title} has no sheet music yet</h3>
            <p className="text-gray-400 max-w-prose">
              Start from a file or from the beat map. Either one opens in the full screen editor, and Save makes it
              the song’s sheet music for the whole band.
            </p>
          </div>

          <div className={`grid gap-3 ${measureCount > 0 ? 'md:grid-cols-2' : ''}`}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={`${tile} border-dashed ${dragging
                ? 'border-blue-400 bg-blue-500/10 text-blue-200'
                : 'border-gray-600 bg-gray-900/60 text-gray-300 hover:border-gray-400 hover:bg-gray-900'}`}
            >
              <span className={dragging ? 'text-blue-300' : 'text-gray-400 group-hover:text-gray-200'}><UploadIcon /></span>
              <span className="space-y-1">
                <span className="block text-base font-semibold text-gray-100">{dragging ? 'Drop it to open' : 'Upload a score'}</span>
                <span className="block text-sm text-gray-400">
                  A MusicXML or MuseScore file: .musicxml, .mxl or .mscz. Choose one, or drop it here.
                </span>
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={SHEET_MUSIC_ACCEPT}
              className="hidden"
              onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }}
            />

            {measureCount > 0 && (
              <button
                type="button"
                onClick={fromBeatMap}
                className={`${tile} border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500 hover:bg-gray-800/80`}
              >
                <span className="text-gray-400 group-hover:text-gray-200"><StaffIcon /></span>
                <span className="space-y-1">
                  <span className="block text-base font-semibold text-gray-100">Start from the beat map</span>
                  <span className="block text-sm text-gray-400">
                    {measureCount} {measureCount === 1 ? 'measure' : 'measures'} with the beat map’s time signatures
                    and section marks, ready for notes.
                  </span>
                </span>
              </button>
            )}
          </div>

          {measureCount === 0 && (
            <p className="text-sm text-gray-500">
              Tap out the song’s measures in the Beat Map Editor and you can start a score from them here.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { songScoreFiles } from '../components/sheet/scoreFiles';
import type { SongConfig } from '../audio/types';
import { songConfigSchema } from '../config/schema';
import { confirmDiscard, toast } from '../store/dialogStore';
import { useSongStore } from '../store/songStore';
import { saveDoc } from '../utils/docRevs';
import { readDoc } from '../offline/sync';
import type { ScoreEditorBridge, SongAudioHost } from './scoreEditorBridge';
import { useAudioEngine } from '../hooks/useAudioEngine';
import type { AudioEngine } from '../audio/AudioEngine';
import { measureBeatTimes } from '../components/sheet/loopSpans';
import { msczCompanionName, sheetMusicConfigFields, uploadMsczForConversion } from './utils/sheetMusic';

const UNSAVED = 'You have unsaved sheet music changes.';

/**
 * The app's audio engine for the editor's playback. The first loop or play
 * from the editor notes the page's own loop and play state, and `release`
 * puts them back when the editor closes.
 */
function engineHost(engine: AudioEngine, beatTimes: number[][]): SongAudioHost & { release(): void } {
  let saved: { a: number | null; b: number | null; enabled: boolean } | null = null;
  const take = () => {
    saved ??= { a: engine.loopA, b: engine.loopB, enabled: engine.loopEnabled };
  };
  return {
    beatTimes,
    play: () => { take(); return engine.play(); },
    pause: () => engine.pause(),
    seek: (seconds) => { take(); void engine.seek(seconds); },
    position: () => engine.clock.audibleTime,
    isPlaying: () => engine.clock.playing,
    setLoop: (from, to) => { take(); engine.setLoop(from, to); },
    clearLoop: () => { take(); engine.setLoopEnabled(false); },
    release() {
      if (!saved) return;
      engine.pause();
      if (saved.a !== null && saved.b !== null) engine.setLoop(saved.a, saved.b);
      else engine.clearLoop();
      engine.setLoopEnabled(saved.enabled);
      saved = null;
    },
  };
}

interface Props {
  bandId: string;
  song: SongConfig;
  onClose: () => void;
}

/**
 * The song's sheet music in MuseEncore's score editor (our own build of it at
 * /score-editor/, see score-editor/main.tsx), full screen over the page.
 * Save sends the edited score to the server as a MuseScore file, which keeps
 * it and converts it to the song's MusicXML, the same as uploading a `.mscz`
 * on the Edit Song page. The editor's own File > Save and Ctrl/Cmd+S do the same.
 */
export function ScoreEditorPanel({ bandId, song, onClose }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  /** null: not saving; otherwise what the save is doing. */
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const files = songScoreFiles(bandId, song);
  const scoreUrl = files?.msczUrl ?? files?.mxlUrl;
  const [src] = useState(() => (scoreUrl ? `/score-editor/?url=${encodeURIComponent(scoreUrl)}` : null));

  const bridge = (): ScoreEditorBridge | undefined => frameRef.current?.contentWindow?.scoreEditor;

  // Playback: the editor can play the song's recording, timed by its tapMap.
  const engine = useAudioEngine();
  const tapMap = useSongStore((s) => (s.selectedSong?.id === song.id ? s.selectedSong.tapMap : song.tapMap));
  const beatTimes = useMemo(() => measureBeatTimes(tapMap), [tapMap]);
  const host = useMemo(() => engineHost(engine, beatTimes), [engine, beatTimes]);
  // The editor's playback toolbar offers Recording or Notation when there's a tapMap to time the recording by.
  const playsRecording = beatTimes.length >= 2;

  useEffect(() => {
    const editor = bridge();
    if (editor) editor.songAudio = playsRecording ? host : null;
  }, [ready, playsRecording, host]);
  // Closing the editor stops what it played and gives the page back its loop.
  useEffect(() => () => host.release(), [host]);


  const save = async () => {
    const editor = bridge();
    const mxlName = song.sheetMusicUrl;
    if (!editor?.hasScore() || !mxlName || saving) return;
    setSaveError(null);
    setSaving('Saving...');
    try {
      const msczName = msczCompanionName(mxlName);
      const bytes = editor.saveMscz(msczName);
      const file = new File([bytes as BlobPart], msczName, { type: 'application/octet-stream', lastModified: Date.now() });
      await uploadMsczForConversion(bandId, song.id, file, mxlName, (sent, total) => {
        setSaving(sent < total ? `Uploading ${Math.round((sent / total) * 100)}%` : 'Converting...');
      });

      // The config notes the MuseScore file and its date. The rest stays as
      // it is: media versions are worked out by the server, never stored.
      const key = `${bandId}/songs/${song.id}/config.json`;
      const current = useSongStore.getState().selectedSong;
      const body: SongConfig = {
        ...(current?.id === song.id ? current : song),
        ...sheetMusicConfigFields({ mode: 'server-convert', file, filename: mxlName }),
      };
      delete body.mediaVersions;
      await saveDoc(key, `/api/bands/${bandId}/songs/${song.id}/config`, body);
      editor.markSaved();
      setDirty(false);

      // The saved config comes back with the new files' versions, so the
      // sheet music on the page shows the change.
      const res = await readDoc(key);
      if (res.ok && useSongStore.getState().selectedSong?.id === song.id) {
        const fresh = songConfigSchema.safeParse(await res.json());
        if (fresh.success) useSongStore.getState().setSelectedSong(fresh.data);
      }
      toast('Sheet music saved');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  };
  // The editor calls the latest save, not the one from its first render.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  const connect = () => {
    const editor = bridge();
    if (!editor) return;
    const sync = () => {
      setReady(editor.hasScore());
      setDirty(editor.isModified());
      setLoadError(editor.loadError());
    };
    editor.onChange = sync;
    editor.onSaveRequest = () => void saveRef.current();
    editor.songAudio = playsRecording ? host : null;
    sync();
  };

  const close = async () => {
    if (saving) return;
    if (bridge()?.isModified() && !(await confirmDiscard(UNSAVED))) return;
    onClose();
  };

  // Leaving the page with changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const btn = 'px-3 py-1.5 rounded text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit sheet music: ${song.title}`}
      className="fixed inset-0 z-[60] flex flex-col bg-gray-950 text-sm text-gray-200 animate-screen-in"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-800 px-3 py-1.5">
        <h2 className="font-semibold text-gray-100 truncate min-w-0">
          Sheet music: {song.title}
        </h2>
        <span className="text-xs text-gray-400" aria-live="polite">
          {saving ?? (dirty ? 'Unsaved changes' : ready ? 'Save puts your changes on the song for the whole band.' : '')}
        </span>
        {saveError && <span className="text-xs text-red-400" role="alert">{saveError}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            className={`${btn} bg-blue-600 hover:bg-blue-500 text-accent-ink`}
            onClick={() => void save()}
            disabled={!ready || !!saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            className={`${btn} text-gray-300 hover:bg-gray-800 hover:text-gray-100`}
            onClick={() => void close()}
            disabled={!!saving}
          >
            Close
          </button>
        </div>
      </div>
      {src ? (
        <div className="relative flex-1 min-h-0">
          <iframe
            ref={frameRef}
            src={src}
            title="Sheet music editor"
            className="absolute inset-0 h-full w-full border-0 bg-white"
            onLoad={connect}
          />
          {loadError && (
            <p role="alert" className="absolute left-1/2 top-4 -translate-x-1/2 rounded bg-gray-900 px-3 py-2 text-red-300 shadow">
              The sheet music couldn't be opened. {loadError}
            </p>
          )}
        </div>
      ) : (
        <p className="p-6 text-gray-400">This song has no sheet music to edit.</p>
      )}
    </div>
  );
}

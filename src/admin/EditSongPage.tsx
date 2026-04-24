import { useReducer, useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { editSongReducer, initialEditState, isDirty } from './editSongReducer';
import { songConfigSchema } from '../config/schema';
import { detectStem, isAudioFile } from './utils/stemDetection';
import { getAudioInfo } from './utils/audioConvert';
import { uploadFileWithProgress, uploadFormWithProgress } from './utils/uploadWithProgress';
import { prepareSheetMusicUpload } from './utils/sheetMusic';
import { SheetMusicUploader } from './SheetMusicUploader';
import { r2Url } from '../utils/url';
import { slugify } from '../utils/deriveId';
import { useBandStore } from '../store/bandStore';
import { useSongStore } from '../store/songStore';
import { useSetlistStore } from '../store/setlistStore';
import type { StemConfig, StemGroupConfig } from '../audio/types';
import { TagInput } from './TagInput';
import { SongKeyInput } from './SongKeyInput';
import { StemColorPicker } from './StemColorPicker';

const groupColors = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6',
];

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '';
}

function toKebab(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function EditSongPage() {
  const { songId = '', bandSlug = '' } = useParams();
  const navigate = useNavigate();
  const currentBand = useBandStore((s) => s.currentBand);
  const manifest = useSongStore((s) => s.manifest);
  const setManifest = useSongStore((s) => s.setManifest);
  const activeSetlist = useSetlistStore((s) => s.activeSetlist);
  const setActiveSetlist = useSetlistStore((s) => s.setActiveSetlist);
  const [state, dispatch] = useReducer(editSongReducer, initialEditState);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Tracks stems added in this edit session. `channels` is captured at
  // add-time so the UI can offer a mono/stereo choice (matching the wizard)
  // without re-decoding the file on every render.
  const [newStemFiles] = useState(() => new Map<string, { file: File; channels: number }>());
  // Sheet music file staged this session but not yet uploaded. Saved
  // during handleSave via /api/r2/presign + PUT; cleared on success.
  const [newSheetMusicFile, setNewSheetMusicFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag-to-reorder state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  // Group creation state
  const [groupLabel, setGroupLabel] = useState('');
  const [groupColor, setGroupColor] = useState(groupColors[0]);
  const [selectedStemIds, setSelectedStemIds] = useState<Set<string>>(new Set());

  // Nav link creation state
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');

  // Nav link drag-to-reorder state
  const [linkDragIdx, setLinkDragIdx] = useState<number | null>(null);
  const [linkDropIdx, setLinkDropIdx] = useState<number | null>(null);
  const onLinkDragStart = (idx: number) => setLinkDragIdx(idx);
  const onLinkDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setLinkDropIdx(idx); };
  const onLinkDragEnd = () => {
    if (linkDragIdx !== null && linkDropIdx !== null && linkDragIdx !== linkDropIdx) {
      dispatch({ type: 'MOVE_NAV_LINK', from: linkDragIdx, to: linkDropIdx });
    }
    setLinkDragIdx(null);
    setLinkDropIdx(null);
  };

  const ensureProtocol = (url: string) =>
    url && !/^https?:\/\//i.test(url) ? `http://${url}` : url;

  // Load config on mount (only once — skip if already loaded)
  const configLoaded = useRef(false);
  useEffect(() => {
    if (configLoaded.current) return;
    if (!songId || !currentBand) { if (!songId) setLoadError('No song ID in URL'); return; }
    (async () => {
      try {
        const configRes = await fetch(r2Url(`${currentBand.id}/songs/${songId}/config.json`));
        if (!configRes.ok) { setLoadError(`Song "${songId}" config not found`); return; }
        const config = songConfigSchema.parse(await configRes.json());
        dispatch({ type: 'INIT', config });
        configLoaded.current = true;
      } catch (err: any) {
        setLoadError(err.message ?? 'Failed to load config');
      }
    })();
  }, [songId, currentBand]);

  // Dirty-state warning
  useEffect(() => {
    if (!isDirty(state) && !newSheetMusicFile) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state, newSheetMusicFile]);

  const handleBack = useCallback(() => {
    const dirty = isDirty(state) || !!newSheetMusicFile;
    if (dirty && !window.confirm('You have unsaved changes. Leave anyway?')) return;
    navigate(`/${bandSlug}`);
  }, [state, newSheetMusicFile, navigate, bandSlug]);

  // Stem reorder handlers
  const onStemDragStart = (idx: number) => setDragIdx(idx);
  const onStemDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDropIdx(idx);
  };
  const onStemDragEnd = () => {
    if (dragIdx !== null && dropIdx !== null && dragIdx !== dropIdx) {
      dispatch({ type: 'MOVE_STEM', from: dragIdx, to: dropIdx });
    }
    setDragIdx(null);
    setDropIdx(null);
  };

  // Add stem via file input
  const handleAddStemFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !isAudioFile(file.name)) return;
      const detected = detectStem(file.name);
      // Deduplicate ID against existing stems
      const existingIds = new Set(state.config?.stems.map((s) => s.id) ?? []);
      let id = detected.id;
      let suffix = 2;
      while (existingIds.has(id)) { id = `${detected.id}-${suffix++}`; }

      let channels = 1;
      try {
        const info = await getAudioInfo(file);
        channels = info.channels;
      } catch {
        // Decoding failed (unsupported codec / corrupt file). Fall back to mono;
        // the stereo toggle just won't render.
      }

      const stem: StemConfig = {
        id,
        label: detected.label,
        file: file.name,
        defaultVolume: detected.defaultVolume,
        defaultPan: detected.defaultPan,
        color: detected.color,
      };
      newStemFiles.set(id, { file, channels });
      dispatch({ type: 'ADD_STEM', stem });
    },
    [state.config, newStemFiles],
  );

  // Finalize a newly-added stem's id from its label on blur. Doing this on
  // every keystroke churns the row's React key (`stem.id + i`) and the
  // label input loses focus; blur is the natural finalize point. Existing
  // stems keep their id — renaming one would orphan the R2 audio.
  const finalizeStemIdFromLabel = useCallback(
    (index: number, stem: StemConfig) => {
      if (!newStemFiles.has(stem.id)) return;
      const base = toKebab(stem.label);
      if (!base) return;
      const otherIds = new Set(
        (state.config?.stems ?? []).filter((_, i) => i !== index).map((s) => s.id),
      );
      let newId = base;
      let n = 2;
      while (otherIds.has(newId)) newId = `${base}-${n++}`;
      if (newId === stem.id) return;

      const entry = newStemFiles.get(stem.id);
      if (entry) {
        newStemFiles.delete(stem.id);
        newStemFiles.set(newId, entry);
      }
      dispatch({ type: 'UPDATE_STEM', index, updates: { id: newId } });
    },
    [state.config, newStemFiles],
  );

  // Group helpers
  const config = state.config;
  const assignedStemIds = new Set((config?.groups ?? []).flatMap((g) => g.stemIds));
  const availableStems = (config?.stems ?? []).filter((s) => !assignedStemIds.has(s.id));
  const canAddGroup = groupLabel.trim() !== '' && selectedStemIds.size > 0;

  const handleAddGroup = () => {
    const id = groupLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const group: StemGroupConfig = {
      id,
      label: groupLabel.trim(),
      color: groupColor,
      stemIds: Array.from(selectedStemIds),
    };
    dispatch({ type: 'ADD_GROUP', group });
    setGroupLabel('');
    setSelectedStemIds(new Set());
    setGroupColor(groupColors[((config?.groups ?? []).length + 1) % groupColors.length]);
  };

  const toggleStem = (stemId: string) => {
    setSelectedStemIds((prev) => {
      const next = new Set(prev);
      if (next.has(stemId)) next.delete(stemId);
      else next.add(stemId);
      return next;
    });
  };

  // Save. A staged sheet-music file lives outside the reducer's config
  // (it's held in local useState until upload), so picking one wouldn't
  // flip `isDirty` on its own — include it explicitly or the Save button
  // stays disabled on add/replace. Remove clears config.sheetMusicUrl
  // via dispatch and flips dirty the normal way.
  const validation = config ? songConfigSchema.safeParse(config) : null;
  const canSave = (isDirty(state) || !!newSheetMusicFile) && validation?.success && !state.saving;

  const handleSave = async () => {
    if (!config || !currentBand) return;
    dispatch({ type: 'SET_SAVING', saving: true });
    try {
      const oldId = state.original!.id;
      const newId = config.id;
      const idChanged = oldId !== newId;

      // Normalize the slug at the save boundary. The reducer stores a
      // permissive live-edited form (trailing hyphens allowed while
      // typing); strip edges here so what lands on R2 is the canonical
      // slug.
      const normalizedSlug = config.slug ? slugify(config.slug) : undefined;

      // Start from the current config; rebind if transcode rewrites filenames
      // so the POST below doesn't send stale extensions (e.g. .wav when R2
      // actually stores .opus, which 404s the player on reload).
      let configToSave: typeof config = { ...config, slug: normalizedSlug };

      // Upload new stem files using OLD id (files still at old location).
      // Send each under `${stemId}${origExt}` so server transcodes to the
      // canonical `${stemId}.opus` — config.stems[].file then matches with no
      // fileMap round-trip.
      if (newStemFiles.size > 0) {
        const formData = new FormData();
        for (const [id, { file }] of newStemFiles) {
          formData.append('stems', file, `${id}${extOf(file.name)}`);
        }

        dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: {
          fileIndex: 0, fileCount: newStemFiles.size, bytesSent: 0, bytesTotal: 1,
        }});

        const uploadResult = await uploadFormWithProgress(
          `/api/r2/transcode-upload/${currentBand.id}/${oldId}`,
          formData,
          (bytesSent, bytesTotal) => {
            dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: {
              fileIndex: 0, fileCount: newStemFiles.size, bytesSent, bytesTotal,
            }});
          },
        );

        if (!uploadResult.ok) throw new Error(uploadResult.error ?? 'Upload failed');

        // Update new-stem filenames to the canonical opus; existing stems
        // keep whatever the saved config already had.
        const updatedStems = config.stems.map((stem) => ({
          ...stem,
          file: newStemFiles.has(stem.id) ? `${stem.id}.opus` : stem.file,
        }));
        configToSave = { ...config, stems: updatedStems };
        dispatch({ type: 'INIT', config: configToSave });
        dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: null });
      }

      // Upload new sheet music, if any. Uses the same oldId path as stems
      // so a concurrent id-rename picks up the file via the /rename copy.
      // Two paths depending on format:
      // - `.mxl` / `.musicxml` / `.xml` → presigned PUT straight to R2;
      //   plain XML gets zipped to MXL client-side (20–50× smaller).
      // - `.mscz` → POSTed to the server-side conversion endpoint, which
      //   shells out to the `mscore` CLI and writes `score.mxl` on R2.
      if (newSheetMusicFile) {
        const prepared = await prepareSheetMusicUpload(newSheetMusicFile);
        if (!prepared) throw new Error('Unsupported sheet music file type');
        if (prepared.mode === 'server-convert') {
          const { file, filename } = prepared;
          const sheetForm = new FormData();
          sheetForm.append('sheetMusic', file, file.name);
          dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: {
            fileIndex: 0, fileCount: 1, bytesSent: 0, bytesTotal: file.size,
          }});
          const convertResult = await uploadFormWithProgress(
            `/api/r2/mscz-convert-upload/${currentBand.id}/${oldId}?filename=${encodeURIComponent(filename)}`,
            sheetForm,
            (bytesSent, bytesTotal) => {
              dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: {
                fileIndex: 0, fileCount: 1, bytesSent, bytesTotal,
              }});
            },
          );
          if (!convertResult.ok) throw new Error(convertResult.error ?? 'MSCZ conversion failed');
          dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: null });
          configToSave = { ...configToSave, sheetMusicUrl: filename };
          dispatch({ type: 'SET_SHEET_MUSIC_URL', url: filename });
        } else {
          const { blob, filename } = prepared;
          const presignRes = await fetch('/api/r2/presign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bandId: currentBand.id, songId: oldId, files: [filename] }),
          });
          if (!presignRes.ok) {
            const err = await presignRes.json().catch(() => ({}));
            throw new Error(err.error ?? 'Sheet music presign failed');
          }
          const { urls } = (await presignRes.json()) as { urls: Record<string, string> };
          const putUrl = urls[filename];
          if (!putUrl) throw new Error('Sheet music presign returned no URL');
          dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: {
            fileIndex: 0, fileCount: 1, bytesSent: 0, bytesTotal: blob.size,
          }});
          await uploadFileWithProgress(putUrl, blob, (bytesSent, bytesTotal) => {
            dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: {
              fileIndex: 0, fileCount: 1, bytesSent, bytesTotal,
            }});
          });
          dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: null });
          configToSave = { ...configToSave, sheetMusicUrl: filename };
          dispatch({ type: 'SET_SHEET_MUSIC_URL', url: filename });
        }
      }

      // Save config to R2 (persisted before rename)
      const res = await fetch(`/api/bands/${currentBand.id}/songs/${oldId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...configToSave, id: oldId }),
      });
      if (!res.ok) throw new Error('Failed to save config');

      if (idChanged) {
        // Rename: copies R2 objects, updates discography/registry
        const renameRes = await fetch(`/api/bands/${currentBand.id}/songs/${oldId}/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newId }),
        });
        if (!renameRes.ok) {
          const err = await renameRes.json();
          throw new Error(err.error ?? 'Rename failed');
        }
      } else if (
        state.original &&
        (config.title !== state.original.title ||
          config.artist !== state.original.artist ||
          config.slug !== state.original.slug)
      ) {
        // Title / artist / slug changed but ID stayed the same —
        // update discography so the manifest's slug entry matches
        // the config. Without this, visiting `#{slug}` after an
        // edit falls through because the manifest still carries
        // the old slug (or none, for legacy songs).
        // overwrite:true because we're replacing the existing entry.
        await fetch(`/api/bands/${currentBand.id}/songs/discography`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: config.id,
            ...(config.slug ? { slug: config.slug } : {}),
            title: config.title,
            artist: config.artist,
            audioBasePath: `${import.meta.env.VITE_R2_PUBLIC_URL}/${currentBand.id}/songs/${config.id}`,
            overwrite: true,
          }),
        });
      }

      // Clean up orphaned sheet-music file. If the user removed or
      // replaced the score with a file of a different name, the old
      // one is now unreferenced in config.json but still sitting on R2.
      // Runs AFTER the rename (if any) so it targets the song's current
      // folder — the rename copies the whole folder, so the orphan
      // follows the song to its new location.
      const oldSheetMusicUrl = state.original?.sheetMusicUrl;
      const newSheetMusicUrl = configToSave.sheetMusicUrl;
      if (oldSheetMusicUrl && oldSheetMusicUrl !== newSheetMusicUrl) {
        const finalId = idChanged ? newId : oldId;
        // Fire-and-forget — don't fail the save if cleanup fails; the
        // config is already authoritative and the orphan is harmless.
        fetch(
          `/api/bands/${currentBand.id}/songs/${finalId}/file/${encodeURIComponent(oldSheetMusicUrl)}`,
          { method: 'DELETE' },
        ).catch(() => { /* leave orphan on R2 rather than break save */ });
      }

      newStemFiles.clear();
      setNewSheetMusicFile(null);
      dispatch({ type: 'SET_SAVE_SUCCESS' });
      dispatch({ type: 'RESET_DIRTY' });

      if (idChanged) {
        // Update song manifest: replace old entry with new id
        if (manifest) {
          setManifest({
            songs: manifest.songs.map((s) =>
              s.id === oldId
                ? { ...s, id: newId, slug: config.slug, title: config.title, artist: config.artist, audioBasePath: `${import.meta.env.VITE_R2_PUBLIC_URL}/${currentBand.id}/songs/${newId}` }
                : s,
            ),
          });
        }

        // Update active setlist if it references the renamed song
        if (activeSetlist) {
          setActiveSetlist({
            ...activeSetlist,
            entries: activeSetlist.entries.map((e) =>
              e.type === 'song' && e.songId === oldId ? { ...e, songId: newId } : e,
            ),
          });
        }

        window.history.replaceState(null, '', `/${bandSlug}/admin/edit-song/${newId}`);
      } else if (
        manifest && state.original &&
        (config.title !== state.original.title ||
          config.artist !== state.original.artist ||
          config.slug !== state.original.slug)
      ) {
        // Title / artist / slug changed without ID change — update manifest
        setManifest({
          songs: manifest.songs.map((s) =>
            s.id === config.id ? { ...s, slug: config.slug, title: config.title, artist: config.artist } : s,
          ),
        });
      }
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', error: err.message ?? 'Save failed' });
    }
  };

  // Loading / error states
  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 p-8">
        <div className="max-w-2xl mx-auto space-y-4">
          <h1 className="text-2xl font-bold">Edit Song</h1>
          <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">{loadError}</div>
          <button onClick={handleBack} className="text-sm text-gray-400 hover:text-gray-200">&larr; Back to app</button>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-400 p-8">Loading config...</div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <header className="px-4 py-3 border-b border-gray-700 flex items-center gap-4">
        <button onClick={handleBack} className="text-sm text-gray-400 hover:text-gray-200">
          &larr; Back to app
        </button>
        <h1 className="text-lg font-semibold">Edit Song</h1>
        <span className="text-sm text-gray-500 font-mono">{config.id}</span>
        <button
          onClick={() => {
            if ((isDirty(state) || newSheetMusicFile) && !window.confirm('You have unsaved edits. Leave anyway?')) return;
            navigate(`/${bandSlug}/admin/align/${config.id}`);
          }}
          className="ml-auto text-sm px-3 py-1 bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded text-gray-200"
        >
          Align stems
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-8">
        {/* Metadata */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Metadata</h2>
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-sm text-gray-400">Title</span>
              <input
                type="text"
                value={config.title}
                onChange={(e) => dispatch({ type: 'SET_TITLE', title: e.target.value })}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm text-gray-400">Artist</span>
              <input
                type="text"
                value={config.artist}
                onChange={(e) => dispatch({ type: 'SET_ARTIST', artist: e.target.value })}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm text-gray-400">Key</span>
              <SongKeyInput
                value={config.key}
                onChange={(key) => dispatch({ type: 'SET_KEY', key })}
              />
            </label>
            <div className="space-y-1">
              <span className="text-sm text-gray-400">Duration</span>
              <p className="px-3 py-2 text-gray-400">{Math.floor(config.durationSeconds / 60)}:{Math.floor(config.durationSeconds % 60).toString().padStart(2, '0')}</p>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-sm text-gray-400">Tags</span>
            <TagInput
              tags={config.tags ?? []}
              onChange={(tags) => dispatch({ type: 'SET_TAGS', tags })}
            />
          </div>

          <label className="space-y-1 block">
            <span className="text-sm text-gray-400">
              URL hash{' '}
              <span className="text-gray-600 text-xs">
                (lowercase, numbers, hyphens)
              </span>
            </span>
            <div className="flex items-center gap-0 w-full bg-gray-800 border border-gray-600 rounded focus-within:border-blue-500">
              <span className="pl-3 py-2 text-gray-500 font-mono text-sm select-none whitespace-nowrap">
                /{bandSlug}#
              </span>
              <input
                type="text"
                value={config.slug ?? ''}
                onChange={(e) => dispatch({ type: 'SET_SLUG', slug: e.target.value })}
                className="flex-1 min-w-0 bg-transparent border-0 rounded-r px-1 py-2 text-gray-100 font-mono text-sm focus:outline-none"
                placeholder={slugify(config.title || 'Song Title')}
              />
            </div>
          </label>

          <SheetMusicUploader
            currentUrl={config.sheetMusicUrl}
            pendingFile={newSheetMusicFile}
            onSelect={(file) => setNewSheetMusicFile(file)}
            onDiscardPending={() => setNewSheetMusicFile(null)}
            onRemoveExisting={() => dispatch({ type: 'SET_SHEET_MUSIC_URL', url: undefined })}
            disabled={state.saving}
          />
          {(config.sheetMusicUrl || newSheetMusicFile) && (
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={!!config.repeatAfterDcDs}
                onChange={(e) => dispatch({ type: 'SET_REPEAT_AFTER_DC_DS', value: e.target.checked })}
                disabled={state.saving}
                className="accent-blue-500"
              />
              <span>Repeat internal sections after D.C. / D.S.</span>
            </label>
          )}

          {state.original && config.id !== state.original.id && (
            <div className="bg-yellow-900/30 border border-yellow-700 rounded p-3 text-sm text-yellow-300">
              Song ID will change: <code className="font-mono">{state.original.id}</code> &rarr; <code className="font-mono">{config.id}</code>
              <br />
              This will move all files and update all references.
            </div>
          )}
        </section>

        {/* Stems */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Stems</h2>
            <span className="text-sm text-gray-400">{config.stems.length} stems</span>
          </div>

          <div className="space-y-3">
            {config.stems.map((stem, i) => (
              <div
                key={stem.id + i}
                draggable
                onDragStart={() => onStemDragStart(i)}
                onDragOver={(e) => onStemDragOver(e, i)}
                onDragEnd={onStemDragEnd}
                className={`bg-gray-800 rounded-lg p-3 space-y-2 transition-opacity ${
                  dragIdx === i ? 'opacity-40' : ''
                } ${dropIdx === i && dragIdx !== null ? 'ring-1 ring-blue-500' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-600 cursor-grab active:cursor-grabbing select-none" title="Drag to reorder">
                    &#x2630;
                  </span>
                  {newStemFiles.has(stem.id) ? (
                    // New stem — match the wizard's circular color + stereo
                    // toggle style so the pair reads as one group.
                    <div className="shrink-0 flex items-center">
                      <StemColorPicker
                        value={stem.color}
                        onChange={(color) => dispatch({ type: 'UPDATE_STEM', index: i, updates: { color } })}
                      >
                        <div className="w-6 h-6 rounded-full border-2 border-gray-600" style={{ backgroundColor: stem.color }} />
                      </StemColorPicker>
                      {(newStemFiles.get(stem.id)?.channels ?? 0) >= 2 && (
                        <button
                          onClick={() => dispatch({ type: 'UPDATE_STEM', index: i, updates: { stereo: !stem.stereo } })}
                          className="-ml-2"
                          title={stem.stereo ? 'Stereo — click for mono' : 'Mono — click for stereo'}
                        >
                          <div
                            className="w-6 h-6 rounded-full border-2 border-gray-600"
                            style={{
                              backgroundColor: stem.stereo ? stem.color : 'transparent',
                              borderColor: stem.stereo ? stem.color : undefined,
                            }}
                          />
                        </button>
                      )}
                    </div>
                  ) : (
                    <StemColorPicker
                      value={stem.color}
                      onChange={(color) => dispatch({ type: 'UPDATE_STEM', index: i, updates: { color } })}
                    >
                      <div className="w-8 h-8 rounded border border-gray-600" style={{ backgroundColor: stem.color }} />
                    </StemColorPicker>
                  )}
                  <input
                    type="text"
                    value={stem.label}
                    onChange={(e) => dispatch({ type: 'UPDATE_STEM', index: i, updates: { label: e.target.value } })}
                    onBlur={() => finalizeStemIdFromLabel(i, stem)}
                    className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-xs text-gray-500 truncate max-w-48">{stem.file}</span>
                  <button
                    onClick={() => dispatch({ type: 'REMOVE_STEM', index: i })}
                    className="text-gray-500 hover:text-red-400 text-sm px-1"
                  >
                    &times;
                  </button>
                </div>

                <div className="flex items-center text-xs text-gray-400 pl-8">
                  <span className="text-gray-600 ml-auto font-mono">{stem.id}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Add stem */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              + Add Stem
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleAddStemFile}
              className="hidden"
            />
          </div>
        </section>

        {/* Groups */}
        <section className="space-y-4 border-t border-gray-700 pt-6">
          <div>
            <h2 className="text-xl font-semibold">Groups</h2>
            <p className="text-sm text-gray-400">Group related stems for collective mixing control.</p>
          </div>

          {(config.groups ?? []).map((group, i) => (
            <div key={i} className="flex items-center gap-3 bg-gray-800 rounded-lg p-3">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: group.color }} />
              <span className="font-medium">{group.label}</span>
              <span className="text-sm text-gray-400">{group.stemIds.length} stems</span>
              <span className="text-xs text-gray-500 ml-auto">{group.stemIds.join(', ')}</span>
              <button
                onClick={() => dispatch({ type: 'REMOVE_GROUP', index: i })}
                className="text-gray-500 hover:text-red-400 text-sm px-1"
              >
                &times;
              </button>
            </div>
          ))}

          {availableStems.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <StemColorPicker value={groupColor} onChange={setGroupColor}>
                  <div className="w-8 h-8 rounded border border-gray-600" style={{ backgroundColor: groupColor }} />
                </StemColorPicker>
                <input
                  type="text"
                  value={groupLabel}
                  onChange={(e) => setGroupLabel(e.target.value)}
                  placeholder="Group name (e.g., Drums)"
                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                />
                <button
                  disabled={!canAddGroup}
                  onClick={handleAddGroup}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm"
                >
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableStems.map((stem) => (
                  <button
                    key={stem.id}
                    onClick={() => toggleStem(stem.id)}
                    className={`px-3 py-1 rounded text-sm border transition-colors ${
                      selectedStemIds.has(stem.id)
                        ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                        : 'border-gray-600 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {stem.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Nav Links */}
        <section className="space-y-4 border-t border-gray-700 pt-6">
          <div>
            <h2 className="text-xl font-semibold">Nav Links</h2>
            <p className="text-sm text-gray-400">Links shown in the production navigation bar. Opens in a new tab.</p>
          </div>

          {(config.navLinks ?? []).map((link, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => onLinkDragStart(i)}
              onDragOver={(e) => onLinkDragOver(e, i)}
              onDragEnd={onLinkDragEnd}
              className={`flex items-center gap-3 bg-gray-800 rounded-lg p-3 transition-opacity ${
                linkDragIdx === i ? 'opacity-40' : ''
              } ${linkDropIdx === i && linkDragIdx !== null ? 'ring-1 ring-blue-500' : ''}`}
            >
              <span className="text-gray-600 cursor-grab active:cursor-grabbing select-none" title="Drag to reorder">
                &#x2630;
              </span>
              <input
                type="text"
                value={link.title}
                maxLength={40}
                onChange={(e) => dispatch({ type: 'UPDATE_NAV_LINK', index: i, link: { ...link, title: e.target.value } })}
                className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                placeholder="Title"
              />
              <input
                type="url"
                value={link.url}
                onChange={(e) => dispatch({ type: 'UPDATE_NAV_LINK', index: i, link: { ...link, url: e.target.value } })}
                onBlur={(e) => { const fixed = ensureProtocol(e.target.value.trim()); if (fixed !== link.url) dispatch({ type: 'UPDATE_NAV_LINK', index: i, link: { ...link, url: fixed } }); }}
                className="flex-[2] bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                placeholder="https://..."
              />
              <button
                onClick={() => dispatch({ type: 'REMOVE_NAV_LINK', index: i })}
                className="text-gray-500 hover:text-red-400 text-sm px-1"
              >
                &times;
              </button>
            </div>
          ))}

          <div className="flex items-center gap-3 bg-gray-800 rounded-lg p-4">
            <input
              type="text"
              value={newLinkTitle}
              maxLength={40}
              onChange={(e) => setNewLinkTitle(e.target.value)}
              placeholder="Link title"
              className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            />
            <input
              type="url"
              value={newLinkUrl}
              onChange={(e) => setNewLinkUrl(e.target.value)}
              placeholder="https://..."
              className="flex-[2] bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            />
            <button
              disabled={!newLinkTitle.trim() || !newLinkUrl.trim()}
              onClick={() => {
                dispatch({ type: 'ADD_NAV_LINK', link: { title: newLinkTitle.trim(), url: ensureProtocol(newLinkUrl.trim()) } });
                setNewLinkTitle('');
                setNewLinkUrl('');
              }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm"
            >
              Add
            </button>
          </div>
        </section>

        {/* Save bar */}
        <section className="border-t border-gray-700 pt-6 space-y-3">
          {!validation?.success && validation?.error && (
            <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
              {validation.error.issues.map((issue, i) => (
                <div key={i}>{issue.path.join('.')}: {issue.message}</div>
              ))}
            </div>
          )}

          {state.error && (
            <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
              {state.error}
            </div>
          )}

          {state.uploadProgress && (() => {
            const pct = state.uploadProgress.bytesTotal
              ? Math.round((state.uploadProgress.bytesSent / state.uploadProgress.bytesTotal) * 100)
              : 0;
            const uploading = pct < 100;
            return (
              <div className="space-y-1">
                <p className="text-sm text-gray-400">
                  {uploading
                    ? `Uploading ${state.uploadProgress.fileCount} stems (${pct}%)...`
                    : 'Transcoding & uploading to storage...'}
                </p>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${uploading ? 'bg-blue-500' : 'bg-blue-500 animate-pulse'}`}
                    style={{ width: uploading ? `${pct}%` : '100%' }}
                  />
                </div>
              </div>
            );
          })()}

          <div className="flex items-center justify-between">
            <span className={`text-sm ${state.saveSuccess ? 'text-green-400' : 'text-gray-500'}`}>
              {state.saveSuccess ? 'Saved successfully' : (isDirty(state) || newSheetMusicFile) ? 'Unsaved changes' : 'No changes'}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if ((isDirty(state) || newSheetMusicFile) && !window.confirm('You have unsaved edits. Leave anyway?')) return;
                  navigate(`/${bandSlug}#${config.slug ?? config.id}`);
                }}
                disabled={state.saving}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-sm font-medium"
              >
                Open Song
              </button>
              <button
                disabled={!canSave}
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
              >
                {state.saving
                  ? state.uploadProgress ? 'Uploading...' : 'Saving...'
                  : 'Save'}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

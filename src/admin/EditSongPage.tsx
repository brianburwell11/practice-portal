import { useReducer, useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { editSongReducer, initialEditState, isDirty } from './editSongReducer';
import { songConfigSchema } from '../config/schema';
import { detectStem, isAudioFile } from './utils/stemDetection';
import { uploadFormWithProgress } from './utils/uploadWithProgress';
import { r2Url } from '../utils/url';
import { useBandStore } from '../store/bandStore';
import { useSongStore } from '../store/songStore';
import { useSetlistStore } from '../store/setlistStore';
import type { StemConfig, StemGroupConfig } from '../audio/types';

const groupColors = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6',
];

export default function EditSongPage() {
  const { songId = '', bandSlug = '' } = useParams();
  const navigate = useNavigate();
  const currentBand = useBandStore((s) => s.currentBand);
  const bandsManifest = useBandStore((s) => s.bandsManifest);
  const setBandsManifest = useBandStore((s) => s.setBandsManifest);
  const setCurrentBand = useBandStore((s) => s.setCurrentBand);
  const manifest = useSongStore((s) => s.manifest);
  const setManifest = useSongStore((s) => s.setManifest);
  const activeSetlist = useSetlistStore((s) => s.activeSetlist);
  const setActiveSetlist = useSetlistStore((s) => s.setActiveSetlist);
  const [state, dispatch] = useReducer(editSongReducer, initialEditState);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newStemFiles] = useState(() => new Map<string, File>());
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
    if (!isDirty(state)) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state]);

  const handleBack = useCallback(() => {
    if (isDirty(state) && !window.confirm('You have unsaved changes. Leave anyway?')) return;
    navigate(`/${bandSlug}`);
  }, [state, navigate, bandSlug]);

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
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !isAudioFile(file.name)) return;
      const detected = detectStem(file.name);
      // Deduplicate ID against existing stems
      const existingIds = new Set(state.config?.stems.map((s) => s.id) ?? []);
      let id = detected.id;
      let suffix = 2;
      while (existingIds.has(id)) { id = `${detected.id}-${suffix++}`; }

      const stem: StemConfig = {
        id,
        label: detected.label,
        file: file.name,
        defaultVolume: detected.defaultVolume,
        defaultPan: detected.defaultPan,
        color: detected.color,
      };
      newStemFiles.set(id, file);
      dispatch({ type: 'ADD_STEM', stem });
      e.target.value = '';
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

  // Save
  const validation = config ? songConfigSchema.safeParse(config) : null;
  const canSave = isDirty(state) && validation?.success && !state.saving;

  const handleSave = async () => {
    if (!config || !currentBand) return;
    dispatch({ type: 'SET_SAVING', saving: true });
    try {
      const oldId = state.original!.id;
      const newId = config.id;
      const idChanged = oldId !== newId;

      // Upload new stem files using OLD id (files still at old location)
      if (newStemFiles.size > 0) {
        const formData = new FormData();
        for (const [, file] of newStemFiles) {
          formData.append('stems', file, file.name);
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

        // Update stem filenames to transcoded versions
        const updatedStems = config.stems.map((stem) => ({
          ...stem,
          file: uploadResult.fileMap[stem.file] ?? stem.file,
        }));
        dispatch({ type: 'INIT', config: { ...config, stems: updatedStems } });
        dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: null });
      }

      // Save config to R2 (persisted before rename)
      const res = await fetch(`/api/bands/${currentBand.id}/songs/${oldId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, id: oldId }),
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
        (config.title !== state.original.title || config.artist !== state.original.artist)
      ) {
        // Title/artist text changed but ID stayed the same — update discography
        await fetch(`/api/bands/${currentBand.id}/songs/discography`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: config.id, title: config.title, artist: config.artist, audioBasePath: `${import.meta.env.VITE_R2_PUBLIC_URL}/${currentBand.id}/songs/${config.id}` }),
        });
      }

      newStemFiles.clear();
      dispatch({ type: 'SET_SAVE_SUCCESS' });
      dispatch({ type: 'RESET_DIRTY' });

      if (idChanged) {
        // Update song manifest: replace old entry with new id
        if (manifest) {
          setManifest({
            songs: manifest.songs.map((s) =>
              s.id === oldId
                ? { ...s, id: newId, title: config.title, artist: config.artist, audioBasePath: `${import.meta.env.VITE_R2_PUBLIC_URL}/${currentBand.id}/songs/${newId}` }
                : s,
            ),
          });
        }

        // Update band songIds: replace old id with new id
        if (bandsManifest && currentBand) {
          const updatedBands = bandsManifest.bands.map((b) =>
            b.id === currentBand.id
              ? { ...b, songIds: b.songIds.map((id) => (id === oldId ? newId : id)) }
              : b,
          );
          setBandsManifest({ bands: updatedBands });
          const updatedBand = updatedBands.find((b) => b.id === currentBand.id);
          if (updatedBand) setCurrentBand(updatedBand);
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
        (config.title !== state.original.title || config.artist !== state.original.artist)
      ) {
        // Title/artist changed without ID change — update manifest
        setManifest({
          songs: manifest.songs.map((s) =>
            s.id === config.id ? { ...s, title: config.title, artist: config.artist } : s,
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
              <input
                type="text"
                value={config.key}
                onChange={(e) => dispatch({ type: 'SET_KEY', key: e.target.value })}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
              />
            </label>
            <div className="space-y-1">
              <span className="text-sm text-gray-400">Duration</span>
              <p className="px-3 py-2 text-gray-400">{Math.floor(config.durationSeconds / 60)}:{Math.floor(config.durationSeconds % 60).toString().padStart(2, '0')}</p>
            </div>
          </div>

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
                  <input
                    type="color"
                    value={stem.color}
                    onChange={(e) => dispatch({ type: 'UPDATE_STEM', index: i, updates: { color: e.target.value } })}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                  />
                  <input
                    type="text"
                    value={stem.label}
                    onChange={(e) => dispatch({ type: 'UPDATE_STEM', index: i, updates: { label: e.target.value } })}
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

                <div className="flex items-center gap-4 text-xs text-gray-400 pl-8">
                  <label className="flex items-center gap-2">
                    Vol
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={stem.defaultVolume}
                      onChange={(e) =>
                        dispatch({ type: 'UPDATE_STEM', index: i, updates: { defaultVolume: parseFloat(e.target.value) } })
                      }
                      className="w-24"
                    />
                    <span className="w-8 text-right">{Math.round(stem.defaultVolume * 100)}%</span>
                  </label>
                  <label className="flex items-center gap-2">
                    Pan
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.1}
                      value={stem.defaultPan}
                      onChange={(e) =>
                        dispatch({ type: 'UPDATE_STEM', index: i, updates: { defaultPan: parseFloat(e.target.value) } })
                      }
                      className="w-24"
                    />
                    <span className="w-8 text-right">
                      {stem.defaultPan === 0 ? 'C' : stem.defaultPan < 0 ? `L${Math.round(Math.abs(stem.defaultPan) * 100)}` : `R${Math.round(stem.defaultPan * 100)}`}
                    </span>
                  </label>
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
                <input
                  type="color"
                  value={groupColor}
                  onChange={(e) => setGroupColor(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                />
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
              {state.saveSuccess ? 'Saved successfully' : isDirty(state) ? 'Unsaved changes' : 'No changes'}
            </span>
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
        </section>
      </main>
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { useBandStore } from '../store/bandStore';
import { useSongStore } from '../store/songStore';
import { useSetlistStore } from '../store/setlistStore';
import { r2Url } from '../utils/url';
import type { SetlistConfig, SetlistEntry, NavLinkConfig } from '../audio/types';

interface SongMeta {
  key: string;
  durationSeconds: number;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface Props {
  setlistId?: string;
  onClose: () => void;
}

export function SetlistModal({ setlistId, onClose }: Props) {
  const currentBand = useBandStore((s) => s.currentBand);
  const manifest = useSongStore((s) => s.manifest);
  const setIndex = useSetlistStore((s) => s.setIndex);
  const storeIndex = useSetlistStore((s) => s.index);
  const activeSetlist = useSetlistStore((s) => s.activeSetlist);
  const setActiveSetlist = useSetlistStore((s) => s.setActiveSetlist);

  const [name, setName] = useState('');
  const [entries, setEntries] = useState<SetlistEntry[]>([]);
  const [navLinks, setNavLinks] = useState<NavLinkConfig[]>([]);
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drag-and-drop state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  // Nav link drag-to-reorder state
  const [linkDragIdx, setLinkDragIdx] = useState<number | null>(null);
  const [linkDropIdx, setLinkDropIdx] = useState<number | null>(null);

  const ensureProtocol = (url: string) =>
    url && !/^https?:\/\//i.test(url) ? `http://${url}` : url;

  const isEdit = !!setlistId;

  // Load existing setlist in edit mode
  useEffect(() => {
    if (!setlistId || !currentBand) return;
    setLoading(true);
    const r2Base = import.meta.env.VITE_R2_PUBLIC_URL;
    fetch(`${r2Base}/${currentBand.id}/setlists/${setlistId}.json`)
      .then((r) => r.json())
      .then((data: SetlistConfig) => {
        setName(data.name);
        setEntries(data.entries);
        setNavLinks(data.navLinks ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [setlistId, currentBand]);

  // Available songs for the picker
  const availableSongs = useMemo(() => {
    if (!manifest || !currentBand) return [];
    return manifest.songs.filter((s) => currentBand.songIds.includes(s.id));
  }, [manifest, currentBand]);

  // Fetch song metadata (key, duration) from config files
  const [songMeta, setSongMeta] = useState<Record<string, SongMeta>>({});
  useEffect(() => {
    if (availableSongs.length === 0 || !currentBand) return;
    const bandId = currentBand.id;
    const fetchMeta = async () => {
      const results: [string, SongMeta][] = [];
      await Promise.all(
        availableSongs.map(async (song) => {
          try {
            const res = await fetch(r2Url(`${bandId}/songs/${song.id}/config.json`));
            const config = await res.json();
            results.push([song.id, { key: config.key ?? '', durationSeconds: config.durationSeconds ?? 0 }]);
          } catch {
            // skip songs whose config can't be loaded
          }
        }),
      );
      setSongMeta(Object.fromEntries(results));
    };
    fetchMeta();
  }, [availableSongs]);

  // Resolve a songId to its manifest entry
  const resolveSong = (id: string) => manifest?.songs.find((s) => s.id === id);

  // Compute total duration and per-set durations
  const { totalSeconds, sets } = useMemo(() => {
    let total = 0;
    const setGroups: { label: string; seconds: number; startIdx: number }[] = [];
    let currentSet: { label: string; seconds: number; startIdx: number } | null = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.type === 'heading') {
        currentSet = { label: entry.label, seconds: 0, startIdx: i };
        setGroups.push(currentSet);
      } else {
        const dur = songMeta[entry.songId]?.durationSeconds ?? 0;
        total += dur;
        if (currentSet) currentSet.seconds += dur;
      }
    }
    return { totalSeconds: total, sets: setGroups };
  }, [entries, songMeta]);

  const deriveSetlistId = (n: string) =>
    'setlist-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const handleSave = async () => {
    if (!currentBand || !name.trim() || entries.length === 0) return;
    setSaving(true);
    setError(null);

    const newId = deriveSetlistId(name);
    const oldId = isEdit ? setlistId! : null;
    const renamed = oldId !== null && oldId !== newId;
    const config: SetlistConfig = {
      id: newId,
      name: name.trim(),
      entries,
      ...(navLinks.length > 0 ? { navLinks } : {}),
    };

    try {
      const res = await fetch(`/api/bands/${currentBand.id}/setlists/${newId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Save failed');
      }

      // If renamed, delete the old setlist from R2
      if (renamed) {
        await fetch(`/api/bands/${currentBand.id}/setlists/${oldId}`, { method: 'DELETE' }).catch(() => {});
      }

      // Update store index optimistically
      const existing = storeIndex ?? [];
      const updated = existing.filter((s) => s.id !== newId && s.id !== oldId);
      updated.push({ id: newId, name: name.trim() });
      setIndex(updated);

      // If editing the active setlist, update it in the store
      if (activeSetlist?.id === oldId || activeSetlist?.id === newId) {
        setActiveSetlist(config);
      }

      onClose();
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  // Drag-and-drop handlers
  const onDragStart = (idx: number) => setDragIdx(idx);
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDropIdx(idx);
  };
  const onDragEnd = () => {
    if (dragIdx !== null && dropIdx !== null && dragIdx !== dropIdx) {
      setEntries((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(dropIdx, 0, moved);
        return next;
      });
    }
    setDragIdx(null);
    setDropIdx(null);
  };

  const addSong = (id: string) => setEntries((prev) => [...prev, { type: 'song', songId: id }]);
  const addSetHeading = () => {
    const setNum = entries.filter((e) => e.type === 'heading').length + 1;
    setEntries((prev) => [...prev, { type: 'heading', label: `Set ${setNum}` }]);
  };
  const removeEntry = (idx: number) => setEntries((prev) => prev.filter((_, i) => i !== idx));
  const updateHeadingLabel = (idx: number, label: string) =>
    setEntries((prev) => prev.map((e, i) => (i === idx && e.type === 'heading' ? { ...e, label } : e)));

  const songCount = entries.filter((e) => e.type === 'song').length;
  const canSave = name.trim().length > 0 && songCount > 0 && !saving;

  // Song numbering: count only songs, not headings
  let songNumber = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6 space-y-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">
          {isEdit ? 'Edit Setlist' : 'Create Setlist'}
        </h2>

        {loading ? (
          <div className="text-sm text-gray-400">Loading...</div>
        ) : (
          <>
            {/* Name input */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Setlist Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                placeholder="e.g. Friday Night Gig"
                autoFocus
                disabled={saving}
              />
            </div>

            <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
              {/* Song picker */}
              <div className="w-1/2 space-y-2">
                <h3 className="text-sm font-medium text-gray-400">Available Songs</h3>
                <div className="space-y-1 overflow-y-auto max-h-60">
                  {availableSongs.map((song) => {
                    const meta = songMeta[song.id];
                    return (
                      <div
                        key={song.id}
                        className="flex items-center gap-2 bg-gray-800 rounded px-3 py-1.5 text-sm"
                      >
                        <span className="truncate flex-1">{song.title}</span>
                        {meta?.durationSeconds ? (
                          <span className="text-xs text-gray-500 shrink-0">{formatDuration(meta.durationSeconds)}</span>
                        ) : null}
                        {meta?.key ? (
                          <span className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-400 shrink-0">{meta.key}</span>
                        ) : null}
                        <button
                          onClick={() => addSong(song.id)}
                          disabled={saving}
                          className="text-blue-400 hover:text-blue-300 text-lg leading-none shrink-0"
                        >
                          +
                        </button>
                      </div>
                    );
                  })}
                  {availableSongs.length === 0 && (
                    <div className="text-sm text-gray-500">No songs in this band</div>
                  )}
                </div>
                <button
                  onClick={addSetHeading}
                  disabled={saving}
                  className="w-full text-xs text-gray-400 hover:text-gray-200 border border-dashed border-gray-600 rounded px-3 py-1.5 hover:border-gray-400"
                >
                  + Add Set Heading
                </button>
              </div>

              {/* Setlist order */}
              <div className="w-1/2 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-400">
                    Setlist Order ({songCount} songs)
                  </h3>
                  {totalSeconds > 0 && (
                    <span className="text-xs text-gray-500">{formatDuration(totalSeconds)} total</span>
                  )}
                </div>
                <div className="space-y-1 overflow-y-auto max-h-60">
                  {entries.map((entry, i) => {
                    const isHeading = entry.type === 'heading';
                    if (!isHeading) songNumber++;
                    const currentSongNumber = songNumber;

                    // Find the set this entry belongs to for per-set time display
                    const setInfo = isHeading ? sets.find((s) => s.startIdx === i) : null;

                    return (
                      <div
                        key={`${isHeading ? 'h' : 's'}-${i}`}
                        draggable
                        onDragStart={() => onDragStart(i)}
                        onDragOver={(e) => onDragOver(e, i)}
                        onDragEnd={onDragEnd}
                        className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-opacity ${
                          isHeading
                            ? 'bg-gray-700/60 border border-gray-600 font-semibold text-gray-200'
                            : 'bg-gray-800'
                        } ${
                          dragIdx === i ? 'opacity-40' : ''
                        } ${dropIdx === i && dragIdx !== null ? 'ring-1 ring-blue-500' : ''}`}
                      >
                        <span
                          className="text-gray-600 cursor-grab active:cursor-grabbing select-none"
                          title="Drag to reorder"
                        >
                          &#x2630;
                        </span>

                        {isHeading ? (
                          <>
                            <input
                              type="text"
                              value={entry.label}
                              onChange={(e) => updateHeadingLabel(i, e.target.value)}
                              className="flex-1 bg-transparent border-none text-sm font-semibold text-gray-200 focus:outline-none px-0"
                              disabled={saving}
                            />
                            {setInfo && setInfo.seconds > 0 && (
                              <span className="text-xs text-gray-400 shrink-0">{formatDuration(setInfo.seconds)}</span>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-gray-500 w-5 text-right">{currentSongNumber}.</span>
                            <span className="truncate flex-1">
                              {resolveSong(entry.songId)?.title ?? entry.songId}
                            </span>
                            {songMeta[entry.songId]?.durationSeconds ? (
                              <span className="text-xs text-gray-500 shrink-0">{formatDuration(songMeta[entry.songId].durationSeconds)}</span>
                            ) : null}
                            {songMeta[entry.songId]?.key ? (
                              <span className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-400 shrink-0">{songMeta[entry.songId].key}</span>
                            ) : null}
                          </>
                        )}

                        <button
                          onClick={() => removeEntry(i)}
                          disabled={saving}
                          className="text-gray-500 hover:text-red-400 text-sm shrink-0"
                        >
                          &times;
                        </button>
                      </div>
                    );
                  })}
                  {entries.length === 0 && (
                    <div className="text-sm text-gray-500">
                      Add songs from the left
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Nav Links */}
            <div className="space-y-2 border-t border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-400">Nav Links</h3>
              <p className="text-xs text-gray-500">Links shown in the production navigation bar when this setlist is active.</p>
              {navLinks.map((link, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={() => setLinkDragIdx(i)}
                  onDragOver={(e) => { e.preventDefault(); setLinkDropIdx(i); }}
                  onDragEnd={() => {
                    if (linkDragIdx !== null && linkDropIdx !== null && linkDragIdx !== linkDropIdx) {
                      setNavLinks((prev) => {
                        const next = [...prev];
                        const [moved] = next.splice(linkDragIdx, 1);
                        next.splice(linkDropIdx, 0, moved);
                        return next;
                      });
                    }
                    setLinkDragIdx(null);
                    setLinkDropIdx(null);
                  }}
                  className={`flex items-center gap-2 bg-gray-800 rounded px-3 py-1.5 text-sm transition-opacity ${
                    linkDragIdx === i ? 'opacity-40' : ''
                  } ${linkDropIdx === i && linkDragIdx !== null ? 'ring-1 ring-blue-500' : ''}`}
                >
                  <span className="text-gray-600 cursor-grab active:cursor-grabbing select-none" title="Drag to reorder">&#x2630;</span>
                  <input
                    type="text"
                    value={link.title}
                    maxLength={40}
                    onChange={(e) => setNavLinks((prev) => prev.map((l, j) => j === i ? { ...l, title: e.target.value } : l))}
                    className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                    placeholder="Title"
                    disabled={saving}
                  />
                  <input
                    type="url"
                    value={link.url}
                    onChange={(e) => setNavLinks((prev) => prev.map((l, j) => j === i ? { ...l, url: e.target.value } : l))}
                    onBlur={(e) => {
                      const fixed = ensureProtocol(e.target.value.trim());
                      if (fixed !== link.url) setNavLinks((prev) => prev.map((l, j) => j === i ? { ...l, url: fixed } : l));
                    }}
                    className="flex-[2] bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                    placeholder="https://..."
                    disabled={saving}
                  />
                  <button
                    onClick={() => setNavLinks((prev) => prev.filter((_, j) => j !== i))}
                    disabled={saving}
                    className="text-gray-500 hover:text-red-400 text-sm shrink-0"
                  >
                    &times;
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newLinkTitle}
                  maxLength={40}
                  onChange={(e) => setNewLinkTitle(e.target.value)}
                  placeholder="Link title"
                  className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                  disabled={saving}
                />
                <input
                  type="url"
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="flex-[2] bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                  disabled={saving}
                />
                <button
                  disabled={!newLinkTitle.trim() || !newLinkUrl.trim() || saving}
                  onClick={() => {
                    setNavLinks((prev) => [...prev, { title: newLinkTitle.trim(), url: ensureProtocol(newLinkUrl.trim()) }]);
                    setNewLinkTitle('');
                    setNewLinkUrl('');
                  }}
                  className="px-2 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs"
                >
                  Add
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
              >
                {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Setlist'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

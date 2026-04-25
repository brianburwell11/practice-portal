import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useBandStore } from '../store/bandStore';
import { useSongStore } from '../store/songStore';
import { useSetlistStore } from '../store/setlistStore';
import { r2Url } from '../utils/url';
import { getCamelotStyle, getCamelotHue, toCamelotCode } from '../utils/camelot';
import { slugify, cleanSlugInput } from '../utils/deriveId';
import { generateId } from '../utils/generateId';
import { CamelotWheel } from '../components/CamelotWheel';
import type { SetlistConfig, SetlistEntry, NavLinkConfig } from '../audio/types';

/** Legacy setlist ids are prefixed with "setlist-". New-format ids are
 *  opaque base62 (7 chars) with no prefix. Detecting the legacy shape
 *  lets us preserve the old rename-and-recreate behavior on existing
 *  setlists while using in-place rename for new ones. */
function isLegacySetlistId(id: string): boolean {
  return id.startsWith('setlist-');
}

interface SongMeta {
  key: string;
  durationSeconds: number;
  tags: string[];
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  // H:MM:SS
  let match = trimmed.match(/^(\d+):([0-5]?\d):([0-5]?\d)$/);
  if (match) return +match[1] * 3600 + +match[2] * 60 + +match[3];

  // M:SS (or MM:SS)
  match = trimmed.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (match) return +match[1] * 60 + +match[2];

  // Written forms: 1hour45minutes, 1h45m, 1hour30, 2h, 45m, 90min, etc.
  const hMatch = trimmed.match(/(\d+)\s*(?:hours?|h)/);
  const mMatch = trimmed.match(/(\d+)\s*(?:minutes?|mins?|m(?!s))/);
  if (hMatch || mMatch) {
    return (hMatch ? +hMatch[1] * 3600 : 0) + (mMatch ? +mMatch[1] * 60 : 0);
  }

  // Plain number as minutes
  const mins = parseInt(trimmed, 10);
  if (!isNaN(mins) && mins >= 0 && /^\d+$/.test(trimmed)) return mins * 60;

  return null;
}

interface Props {
  setlistId?: string;
  copyFromSetlistId?: string;
  onClose: () => void;
}

export function SetlistModal({ setlistId, copyFromSetlistId, onClose }: Props) {
  const currentBand = useBandStore((s) => s.currentBand);
  const manifest = useSongStore((s) => s.manifest);
  const setIndex = useSetlistStore((s) => s.setIndex);
  const storeIndex = useSetlistStore((s) => s.index);
  const activeSetlist = useSetlistStore((s) => s.activeSetlist);
  const setActiveSetlist = useSetlistStore((s) => s.setActiveSetlist);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);

  // Keep the slug in sync with the name until the admin manually
  // edits it \u2014 mirrors the song-wizard's auto-derive behavior.
  useEffect(() => {
    if (!slugEdited) setSlug(slugify(name));
  }, [name, slugEdited]);
  const [entries, setEntries] = useState<SetlistEntry[]>([]);
  const [navLinks, setNavLinks] = useState<NavLinkConfig[]>([]);
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [desiredLengthSeconds, setDesiredLengthSeconds] = useState<number | null>(null);
  const [desiredLengthText, setDesiredLengthText] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filterOpen, setFilterOpen] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  /** Camelot codes the wheel currently recommends as transition targets. */
  const [wheelTargetKeys, setWheelTargetKeys] = useState<Set<string> | null>(null);

  // Closing the wheel always clears the highlight, regardless of which
  // path was taken (toolbar toggle, in-panel ×, etc.).
  useEffect(() => {
    if (!wheelOpen) setWheelTargetKeys(null);
  }, [wheelOpen]);
  const [filterKeys, setFilterKeys] = useState<Set<string>>(new Set());
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
  const [allowDuplicates, setAllowDuplicates] = useState(true);
  const [durationMode, setDurationMode] = useState<'' | 'longer' | 'shorter' | 'fits'>('');
  const [durationText, setDurationText] = useState('');
  const [sortMode, setSortMode] = useState<'title' | 'duration' | 'key'>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const filterRef = useRef<HTMLDivElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const [filterPos, setFilterPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Drag-and-drop state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  // Nav link drag-to-reorder state
  const [linkDragIdx, setLinkDragIdx] = useState<number | null>(null);
  const [linkDropIdx, setLinkDropIdx] = useState<number | null>(null);

  // Close filter dropdown on click outside
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

  const openFilter = useCallback(() => {
    if (filterBtnRef.current) {
      const rect = filterBtnRef.current.getBoundingClientRect();
      setFilterPos({ top: rect.bottom + 4, left: rect.right - 220 });
    }
    setFilterOpen((v) => !v);
  }, []);

  const ensureProtocol = (url: string) =>
    url && !/^https?:\/\//i.test(url) ? `http://${url}` : url;

  const isEdit = !!setlistId;
  const isCopy = !setlistId && !!copyFromSetlistId;
  const [copySourceId, setCopySourceId] = useState<string | null>(null);
  const [copySourceName, setCopySourceName] = useState<string>('');

  // Load existing setlist (edit mode) or source setlist (copy mode)
  useEffect(() => {
    const sourceId = setlistId ?? copyFromSetlistId;
    if (!sourceId || !currentBand) return;
    setLoading(true);
    const r2Base = import.meta.env.VITE_R2_PUBLIC_URL;
    fetch(`${r2Base}/${currentBand.id}/setlists/${sourceId}.json`)
      .then((r) => r.json())
      .then((data: SetlistConfig) => {
        if (!isCopy) {
          setName(data.name);
          if (data.slug) setSlug(data.slug);
        }
        setEntries(data.entries);
        setNavLinks(data.navLinks ?? []);
        if (data.desiredLengthSeconds) {
          setDesiredLengthSeconds(data.desiredLengthSeconds);
          setDesiredLengthText(formatDuration(data.desiredLengthSeconds));
        }
        if (isCopy) {
          setCopySourceId(data.id);
          setCopySourceName(data.name);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [setlistId, copyFromSetlistId, currentBand, isCopy]);

  // Available songs for the picker — the manifest is already scoped to the current band.
  const availableSongs = useMemo(() => {
    if (!manifest || !currentBand) return [];
    return manifest.songs;
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
            results.push([song.id, { key: config.key ?? '', durationSeconds: config.durationSeconds ?? 0, tags: config.tags ?? [] }]);
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

  // Unique keys across available songs, sorted
  const uniqueKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const song of availableSongs) {
      const k = songMeta[song.id]?.key;
      if (k) keys.add(k);
    }
    return [...keys].sort();
  }, [availableSongs, songMeta]);

  const uniqueTags = useMemo(() => {
    const tags = new Set<string>();
    for (const song of availableSongs) {
      for (const t of songMeta[song.id]?.tags ?? []) tags.add(t);
    }
    return [...tags].sort();
  }, [availableSongs, songMeta]);

  // Compute time remaining for "fits remaining" filter
  const timeRemaining = desiredLengthSeconds && desiredLengthSeconds > 0
    ? desiredLengthSeconds - totalSeconds
    : null;

  const durationActive =
    (durationMode === 'longer' && !!parseDuration(durationText)) ||
    (durationMode === 'shorter' && !!parseDuration(durationText)) ||
    (durationMode === 'fits' && timeRemaining !== null && timeRemaining > 0);

  const hasActiveFilters = filterKeys.size > 0 || filterTags.size > 0 || durationActive || !allowDuplicates;

  // IDs of songs already in the setlist (for the "no duplicates" filter)
  const setlistSongIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entries) {
      if (e.type === 'song') ids.add(e.songId);
    }
    return ids;
  }, [entries]);

  // Filtered available songs
  const filteredSongs = useMemo(() => {
    if (!hasActiveFilters) return availableSongs;
    const durSec = parseDuration(durationText);
    return availableSongs.filter((song) => {
      if (!allowDuplicates && setlistSongIds.has(song.id)) return false;
      const meta = songMeta[song.id];
      if (filterKeys.size > 0 && (!meta?.key || !filterKeys.has(meta.key))) return false;
      if (filterTags.size > 0) {
        const songTags = meta?.tags ?? [];
        if (!songTags.some((t) => filterTags.has(t))) return false;
      }
      const dur = meta?.durationSeconds ?? 0;
      if (durationMode === 'longer' && durSec && dur < durSec) return false;
      if (durationMode === 'shorter' && durSec && dur > durSec) return false;
      if (durationMode === 'fits' && timeRemaining !== null && timeRemaining > 0 && dur > timeRemaining) return false;
      return true;
    });
  }, [availableSongs, songMeta, filterKeys, filterTags, durationMode, durationText, timeRemaining, hasActiveFilters, allowDuplicates, setlistSongIds]);

  // Sorted display list — applies on top of the filtered songs. Unknown
  // values (missing key / duration) always sort to the end regardless
  // of direction so the useful rows land near the top.
  const displaySongs = useMemo(() => {
    const arr = [...filteredSongs];
    const mul = sortDir === 'desc' ? -1 : 1;
    if (sortMode === 'title') {
      arr.sort((a, b) => a.title.localeCompare(b.title) * mul);
    } else if (sortMode === 'duration') {
      arr.sort((a, b) => {
        const da = songMeta[a.id]?.durationSeconds ?? 0;
        const db = songMeta[b.id]?.durationSeconds ?? 0;
        if (da === 0 && db !== 0) return 1;
        if (db === 0 && da !== 0) return -1;
        return (da - db) * mul;
      });
    } else if (sortMode === 'key') {
      arr.sort((a, b) => {
        const ka = songMeta[a.id]?.key ?? '';
        const kb = songMeta[b.id]?.key ?? '';
        if (!ka && kb) return 1;
        if (!kb && ka) return -1;
        return ka.localeCompare(kb) * mul;
      });
    }
    return arr;
  }, [filteredSongs, sortMode, sortDir, songMeta]);

  // Legacy rename path: old ids were derived as `setlist-{slug(name)}`.
  // Kept only for renaming pre-existing legacy setlists (they still
  // need the old copy-and-delete R2 dance on a name change).
  const deriveLegacySetlistId = (n: string) =>
    'setlist-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Canonicalize the slug at save time \u2014 input is live-sanitized
  // (trailing hyphens allowed mid-typing) so strip edges here. When
  // the admin hasn't touched the field, fall back to the auto-derived
  // kebab form of the name.
  const effectiveSlug = slugify(slug) || slugify(name);

  const handleSave = async () => {
    if (!currentBand || !name.trim() || entries.length === 0) return;
    setSaving(true);
    setError(null);

    const oldId = isEdit ? setlistId! : null;
    const editingLegacy = isEdit && oldId !== null && isLegacySetlistId(oldId);

    // New-format setlists (create or copy) get a fresh opaque id.
    // Legacy edits keep the derive-from-name behavior so renaming a
    // legacy setlist still produces a new legacy-shaped id + moves R2.
    // Opaque edits keep the same id across renames.
    let newId: string;
    if (!isEdit) {
      newId = generateId();
    } else if (editingLegacy) {
      newId = deriveLegacySetlistId(name);
    } else {
      newId = oldId!;
    }
    const renamed = oldId !== null && oldId !== newId;

    const config: SetlistConfig = {
      id: newId,
      ...(effectiveSlug ? { slug: effectiveSlug } : {}),
      name: name.trim(),
      entries,
      ...(navLinks.length > 0 ? { navLinks } : {}),
      ...(desiredLengthSeconds ? { desiredLengthSeconds } : {}),
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
      updated.push({ id: newId, slug: effectiveSlug || undefined, name: name.trim() });
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
  // Copy-as-new always gets a fresh opaque id, so the old
  // slug-collision guard is no longer meaningful \u2014 but keep the
  // "pick a different name" nudge if the admin types the source name
  // verbatim on a copy, since the URL slug would otherwise collide.
  const nameCollidesWithSource =
    isCopy && copySourceId !== null && copySourceName
      ? name.trim() === copySourceName
      : false;
  const canSave = name.trim().length > 0 && songCount > 0 && !saving && !nameCollidesWithSource;

  // Song numbering: count only songs, not headings
  let songNumber = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {wheelOpen && (
        <div
          className="absolute hidden lg:block bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-3"
          style={{
            top: '50%',
            right: 'calc(50% + 21rem + 1rem)',
            transform: 'translateY(-50%)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setWheelOpen(false)}
            className="absolute top-1 right-2 text-gray-500 hover:text-gray-300 text-base leading-none z-10"
            title="Close"
          >
            ×
          </button>
          <CamelotWheel
            size={320}
            onTargetKeysChange={(keys) =>
              setWheelTargetKeys(keys && keys.length > 0 ? new Set(keys) : null)
            }
          />
        </div>
      )}
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold shrink-0 mb-4">
          {isEdit ? 'Edit Setlist' : 'Create Setlist'}
        </h2>

        {loading ? (
          <div className="text-sm text-gray-400">Loading...</div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 -mr-2 pr-2">
            {/* Name input */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Setlist Name</label>
              <div className="relative">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onDoubleClick={() => {
                    if (isCopy && !name && copySourceName) setName(`${copySourceName} (copy)`);
                  }}
                  className={`w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 ${
                    isCopy && !name && copySourceName ? 'pr-32' : ''
                  }`}
                  placeholder={isCopy && copySourceName ? `${copySourceName} (copy)` : 'Friday Night Gig'}
                  autoFocus
                  disabled={saving}
                />
                {isCopy && !name && copySourceName && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-gray-500 pointer-events-none select-none">
                    double click to use
                  </span>
                )}
              </div>
              {nameCollidesWithSource && (
                <p className="mt-1 text-xs text-red-400">Pick a name different from the original setlist.</p>
              )}
            </div>

            {/* URL slug + set length on one row */}
            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-0">
                <label className="block text-sm text-gray-400 mb-1">
                  URL slug{' '}
                  <span className="text-gray-600 text-xs">
                    (lowercase, numbers, hyphens)
                  </span>
                </label>
                <div className="flex items-center gap-0 w-full bg-gray-800 border border-gray-600 rounded focus-within:border-blue-500">
                  <span className="pl-3 py-2 text-gray-500 font-mono text-xs select-none whitespace-nowrap">
                    /{currentBand?.route ?? ''}?setlist=
                  </span>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => {
                      setSlug(cleanSlugInput(e.target.value));
                      setSlugEdited(true);
                    }}
                    className="flex-1 min-w-0 bg-transparent border-0 px-1 py-2 text-sm text-gray-200 font-mono focus:outline-none"
                    placeholder={slugify(name || 'Friday Night Gig')}
                    disabled={saving}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Set Length</label>
                <input
                  type="text"
                  value={desiredLengthText}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDesiredLengthText(v);
                    // Empty input is the admin's intent to clear the
                    // stored seconds. A non-empty-but-unparseable
                    // string (e.g. mid-typing "1:") leaves the
                    // previously-parsed value alone so we don't thrash.
                    if (v === '') {
                      setDesiredLengthSeconds(null);
                    } else {
                      const parsed = parseDuration(v);
                      if (parsed !== null) setDesiredLengthSeconds(parsed);
                    }
                  }}
                  onBlur={() => {
                    if (desiredLengthSeconds) {
                      setDesiredLengthText(formatDuration(desiredLengthSeconds));
                    } else {
                      setDesiredLengthText('');
                      setDesiredLengthSeconds(null);
                    }
                  }}
                  className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  placeholder="HH:MM:SS"
                  disabled={saving}
                />
              </div>
              {desiredLengthSeconds != null && desiredLengthSeconds > 0 && (() => {
                const remaining = desiredLengthSeconds - totalSeconds;
                const isOver = remaining < 0;
                return (
                  <span className={`text-xs pb-2 ${isOver ? 'text-red-400' : 'text-gray-500'}`}>
                    {isOver ? '-' : ''}{formatDuration(Math.abs(remaining))} {isOver ? 'over' : 'remaining'}
                  </span>
                );
              })()}
            </div>

            <div className="flex gap-4">
              {/* Song picker */}
              <div className="w-1/2 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-400">Available Songs</h3>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setWheelOpen((v) => !v)}
                      className={`p-1 rounded hover:bg-gray-700 ${wheelOpen ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                      title="Camelot wheel"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="8" cy="8" r="6.5" />
                        <circle cx="8" cy="8" r="2.5" />
                        <path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.8 2.8M9.8 9.8l2.8 2.8M12.6 3.4L9.8 6.2M6.2 9.8l-2.8 2.8" />
                      </svg>
                    </button>
                    <button
                      ref={filterBtnRef}
                      onClick={openFilter}
                      className={`p-1 rounded hover:bg-gray-700 ${hasActiveFilters || sortMode !== 'title' || sortDir !== 'asc' ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                      title="Filter & sort songs"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1.5 2h13M3.5 5.5h9M5.5 9h5M7 12.5h2" />
                      </svg>
                    </button>
                  </div>
                  {filterOpen && createPortal(
                    <div
                      ref={filterRef}
                      className="fixed z-[100] bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 space-y-3"
                      style={{ width: 220, top: filterPos.top, left: filterPos.left }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Sort */}
                      <div className="space-y-1.5">
                        <div className="text-xs text-gray-400">Sort by</div>
                        <div className="flex items-center gap-2">
                          <select
                            value={sortMode}
                            onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
                            className="flex-1 min-w-0 bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                          >
                            <option value="title">Title</option>
                            <option value="duration">Duration</option>
                            <option value="key">Key</option>
                          </select>
                          <select
                            value={sortDir}
                            onChange={(e) => setSortDir(e.target.value as typeof sortDir)}
                            className="flex-1 min-w-0 bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                          >
                            <option value="asc">Ascending</option>
                            <option value="desc">Descending</option>
                          </select>
                        </div>
                      </div>
                      {/* Allow duplicates toggle */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">Allow duplicates</span>
                        <button
                          type="button"
                          onClick={() => setAllowDuplicates((v) => !v)}
                          aria-pressed={allowDuplicates}
                          className={`relative inline-flex h-4 w-10 items-center rounded-full transition-colors ${
                            allowDuplicates ? 'bg-green-600' : 'bg-red-600'
                          }`}
                        >
                          <span
                            className={`absolute inset-y-0 flex items-center text-[8px] font-bold text-white tracking-wide leading-none ${
                              allowDuplicates ? 'left-1' : 'right-1'
                            }`}
                          >
                            {allowDuplicates ? 'YES' : 'NO'}
                          </span>
                          <span
                            className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                              allowDuplicates ? 'translate-x-6' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                      {/* Duration filter */}
                      <div className="space-y-1.5">
                        <div className="text-xs text-gray-400">Duration</div>
                        <div className="flex items-center gap-2">
                          <select
                            value={durationMode}
                            onChange={(e) => setDurationMode(e.target.value as typeof durationMode)}
                            className="bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                          >
                            <option value="">No filter</option>
                            <option value="longer">Longer than</option>
                            <option value="shorter">Shorter than</option>
                            {timeRemaining !== null && timeRemaining > 0 && (
                              <option value="fits">Fits remaining</option>
                            )}
                          </select>
                          {(durationMode === 'longer' || durationMode === 'shorter') && (
                            <input
                              type="text"
                              value={durationText}
                              onChange={(e) => setDurationText(e.target.value)}
                              className="flex-1 min-w-0 bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                              placeholder="3:00"
                            />
                          )}
                          {durationMode === 'fits' && timeRemaining !== null && timeRemaining > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-gray-700 text-xs text-gray-300">
                              ≤ {formatDuration(timeRemaining)}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Key filter */}
                      {uniqueKeys.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-400 mb-1.5">Key</div>
                          <div className="flex flex-wrap gap-1">
                            {uniqueKeys.map((k) => {
                              const selected = filterKeys.has(k);
                              const cs = getCamelotStyle(k);
                              return (
                                <button
                                  key={k}
                                  onClick={() => setFilterKeys((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(k)) next.delete(k); else next.add(k);
                                    return next;
                                  })}
                                  className={`px-1.5 py-0.5 rounded text-xs transition-opacity ${selected ? 'ring-1 ring-white/50' : 'opacity-50 hover:opacity-80'}`}
                                  style={cs ? { backgroundColor: cs.bg, color: cs.color } : { backgroundColor: '#374151', color: '#9ca3af' }}
                                >
                                  {k}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {/* Tag filter */}
                      {uniqueTags.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-400 mb-1.5">Tags</div>
                          <div className="flex flex-wrap gap-1">
                            {uniqueTags.map((t) => {
                              const selected = filterTags.has(t);
                              return (
                                <button
                                  key={t}
                                  onClick={() => setFilterTags((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(t)) next.delete(t); else next.add(t);
                                    return next;
                                  })}
                                  className={`px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-300 transition-opacity ${selected ? 'ring-1 ring-white/50' : 'opacity-50 hover:opacity-80'}`}
                                >
                                  {t}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {/* Clear */}
                      {hasActiveFilters && (
                        <button
                          onClick={() => {
                            setFilterKeys(new Set());
                            setFilterTags(new Set());
                            setDurationMode('');
                            setDurationText('');
                            setAllowDuplicates(true);
                          }}
                          className="text-xs text-gray-500 hover:text-gray-300"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>,
                    document.body,
                  )}
                </div>
                <div className="space-y-1 overflow-y-auto max-h-60">
                  {displaySongs.map((song) => {
                    const meta = songMeta[song.id];
                    const songCamelot = meta?.key ? toCamelotCode(meta.key) : null;
                    const recommended =
                      wheelTargetKeys !== null && songCamelot !== null && wheelTargetKeys.has(songCamelot);
                    const recHue = recommended && meta?.key ? getCamelotHue(meta.key) : null;
                    return (
                      <div
                        key={song.id}
                        className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors ${
                          recommended ? '' : 'bg-gray-800'
                        }`}
                        style={
                          recHue !== null
                            ? {
                                backgroundColor: `hsl(${recHue} 50% 22%)`,
                                boxShadow: `0 0 0 1px hsl(${recHue} 80% 65%)`,
                              }
                            : undefined
                        }
                      >
                        <span className="truncate flex-1">{song.title}</span>
                        {meta?.durationSeconds ? (
                          <span className="text-xs text-gray-500 shrink-0">{formatDuration(meta.durationSeconds)}</span>
                        ) : null}
                        {(() => {
                          const k = meta?.key?.trim();
                          if (!k) return <span className="shrink-0" style={{ minWidth: 36 }} aria-hidden="true" />;
                          const cs = getCamelotStyle(k);
                          return (
                            <span
                              className={`px-1.5 py-0.5 rounded text-xs shrink-0 text-center ${cs ? '' : 'bg-gray-700 text-gray-400'}`}
                              style={{ minWidth: 36, ...(cs ? { backgroundColor: cs.bg, color: cs.color } : {}) }}
                            >{k}</span>
                          );
                        })()}
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
                  {filteredSongs.length === 0 && (
                    <div className="text-sm text-gray-500">
                      {hasActiveFilters ? 'No songs match filters' : 'No songs in this band'}
                    </div>
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

                    const setlistKey = !isHeading ? songMeta[entry.songId]?.key : undefined;
                    const setlistCamelot = setlistKey ? toCamelotCode(setlistKey) : null;
                    const setlistRecommended =
                      wheelTargetKeys !== null && setlistCamelot !== null && wheelTargetKeys.has(setlistCamelot);
                    const setlistRecHue = setlistRecommended && setlistKey ? getCamelotHue(setlistKey) : null;

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
                            : setlistRecHue !== null ? '' : 'bg-gray-800'
                        } ${
                          dragIdx === i ? 'opacity-40' : ''
                        } ${dropIdx === i && dragIdx !== null && setlistRecHue === null ? 'ring-1 ring-blue-500' : ''}`}
                        style={
                          setlistRecHue !== null
                            ? {
                                backgroundColor: `hsl(${setlistRecHue} 50% 22%)`,
                                boxShadow:
                                  dropIdx === i && dragIdx !== null
                                    ? `0 0 0 1px hsl(${setlistRecHue} 80% 65%), 0 0 0 2px rgb(59 130 246)`
                                    : `0 0 0 1px hsl(${setlistRecHue} 80% 65%)`,
                              }
                            : undefined
                        }
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
                            {(() => {
                              const k = songMeta[entry.songId]?.key?.trim();
                              if (!k) return <span className="shrink-0" style={{ minWidth: 36 }} aria-hidden="true" />;
                              const cs = getCamelotStyle(k);
                              return (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-xs shrink-0 text-center ${cs ? '' : 'bg-gray-700 text-gray-400'}`}
                                  style={{ minWidth: 36, ...(cs ? { backgroundColor: cs.bg, color: cs.color } : {}) }}
                                >{k}</span>
                              );
                            })()}
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
            </div>

            <div className="flex justify-end gap-3 shrink-0 mt-4">
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

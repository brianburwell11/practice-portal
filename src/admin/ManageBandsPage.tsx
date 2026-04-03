import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bandsManifestSchema, songManifestSchema } from '../config/schema';
import { assetUrl } from '../utils/url';
import type { BandConfig, BandColors, SongManifestEntry } from '../audio/types';

const defaultColors: BandColors = {
  primary: '#3b82f6',
  accent: '#f59e0b',
  background: '#111827',
  text: '#f3f4f6',
};

function emptyBand(): BandConfig {
  return {
    id: '',
    name: '',
    route: '',
    colors: { ...defaultColors },
    songIds: [],
  };
}

export default function ManageBandsPage() {
  const navigate = useNavigate();
  const [bands, setBands] = useState<BandConfig[]>([]);
  const [allSongs, setAllSongs] = useState<SongManifestEntry[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<BandConfig>(emptyBand());
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [logoCacheBust, setLogoCacheBust] = useState(0);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Load bands + songs manifest
  useEffect(() => {
    fetch(assetUrl('bands.json'))
      .then((r) => r.json())
      .then((data) => setBands(bandsManifestSchema.parse(data).bands))
      .catch((err) => setError(String(err)));

    fetch(assetUrl('audio/manifest.json'))
      .then((r) => r.json())
      .then((data) => setAllSongs(songManifestSchema.parse(data).songs))
      .catch((err) => setError(String(err)));
  }, []);

  const isNew = editingIndex === null;

  const startAdd = () => {
    setEditingIndex(null);
    setDraft(emptyBand());
    setFormOpen(true);
    setError(null);
    setSuccess(null);
  };

  const startEdit = (index: number) => {
    const band = bands[index];
    setEditingIndex(index);
    setDraft({ ...band, colors: { ...band.colors }, songIds: [...band.songIds] });
    setFormOpen(true);
    setError(null);
    setSuccess(null);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setDraft(emptyBand());
    setFormOpen(false);
  };

  const updateDraft = (updates: Partial<BandConfig>) => {
    setDraft((d) => ({ ...d, ...updates }));
  };

  const updateColor = (key: keyof BandColors, value: string) => {
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }));
  };

  const toggleSong = (songId: string) => {
    setDraft((d) => ({
      ...d,
      songIds: d.songIds.includes(songId)
        ? d.songIds.filter((id) => id !== songId)
        : [...d.songIds, songId],
    }));
  };

  // Auto-generate id and route from name
  const handleNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const route = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
    const updates: Partial<BandConfig> = { name };
    if (isNew || draft.id === '' || draft.id === nameToSlug(draft.name)) {
      updates.id = slug;
    }
    if (isNew || draft.route === '' || draft.route === nameToRoute(draft.name)) {
      updates.route = route;
    }
    updateDraft(updates);
  };

  const handleSave = async () => {
    if (!draft.name || !draft.id || !draft.route) {
      setError('Name, ID, and route are required');
      return;
    }

    // Check for duplicate routes (excluding current band if editing)
    const dupeRoute = bands.some(
      (b, i) => b.route === draft.route && i !== editingIndex,
    );
    if (dupeRoute) {
      setError(`Route "${draft.route}" is already taken`);
      return;
    }

    setSaving(true);
    setError(null);

    const updated = [...bands];
    if (editingIndex !== null) {
      updated[editingIndex] = draft;
    } else {
      updated.push(draft);
    }

    try {
      const res = await fetch('/api/bands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bands: updated }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Save failed');
      }
      setBands(updated);
      setDraft(emptyBand());
      setEditingIndex(null);
      setFormOpen(false);
      setSuccess(editingIndex !== null ? 'Band updated' : 'Band added');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (index: number) => {
    const band = bands[index];
    if (!window.confirm(`Delete "${band.name}"? This cannot be undone.`)) return;

    setSaving(true);
    const updated = bands.filter((_, i) => i !== index);

    try {
      const res = await fetch('/api/bands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bands: updated }),
      });
      if (!res.ok) throw new Error('Delete failed');
      setBands(updated);
      if (editingIndex === index) {
        setEditingIndex(null);
        setDraft(emptyBand());
      }
      setSuccess('Band deleted');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message ?? 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!draft.id) {
      setError('Enter a band name before uploading a logo');
      e.target.value = '';
      return;
    }

    setUploadingLogo(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('logo', file, file.name);
      const res = await fetch(`/api/bands/${draft.id}/logo`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Upload failed');
      }
      const { path: logoPath } = await res.json();
      updateDraft({ logo: logoPath });
      setLogoCacheBust(Date.now());
    } catch (err: any) {
      setError(err.message ?? 'Logo upload failed');
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  };

  const removeLogo = () => {
    updateDraft({ logo: undefined });
  };

  const [formOpen, setFormOpen] = useState(false);
  const isEditing = formOpen || editingIndex !== null;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="px-4 py-3 border-b border-gray-700 flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          &larr; Back
        </button>
        <h1 className="text-lg font-semibold">Manage Bands</h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-8">
        {/* Status messages */}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-900/30 border border-green-700 rounded p-3 text-sm text-green-300">
            {success}
          </div>
        )}

        {/* Existing bands */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Bands</h2>
            <span className="text-sm text-gray-400">{bands.length} bands</span>
          </div>

          {bands.length === 0 ? (
            <p className="text-gray-500 text-sm">No bands configured yet.</p>
          ) : (
            <div className="space-y-2">
              {bands.map((band, i) => (
                <div
                  key={band.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    editingIndex === i
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-gray-700 bg-gray-800'
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded flex items-center justify-center text-sm font-bold shrink-0"
                    style={{ backgroundColor: band.colors.primary, color: band.colors.text }}
                  >
                    {band.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{band.name}</div>
                    <div className="text-xs text-gray-400">
                      /{band.route} &middot; {band.songIds.length} songs
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <ColorDot color={band.colors.primary} label="primary" />
                    <ColorDot color={band.colors.accent} label="accent" />
                    <ColorDot color={band.colors.background} label="bg" />
                  </div>
                  <button
                    onClick={() => startEdit(i)}
                    className="text-sm text-gray-400 hover:text-gray-200 px-2"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(i)}
                    className="text-sm text-gray-500 hover:text-red-400 px-1"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}

          {!isEditing && (
            <button
              onClick={startAdd}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              + Add Band
            </button>
          )}
        </section>

        {/* Edit / Add form */}
        {isEditing && (
          <section className="space-y-6 border-t border-gray-700 pt-6">
            <h2 className="text-xl font-semibold">
              {editingIndex !== null ? `Edit: ${bands[editingIndex].name}` : 'New Band'}
            </h2>

            {/* Name / ID / Route */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="space-y-1">
                <span className="text-sm text-gray-400">Name</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="My Band"
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm text-gray-400">ID</span>
                <input
                  type="text"
                  value={draft.id}
                  onChange={(e) => updateDraft({ id: e.target.value })}
                  placeholder="my-band"
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-100 font-mono text-sm focus:outline-none focus:border-blue-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm text-gray-400">Route</span>
                <div className="flex items-center bg-gray-800 border border-gray-600 rounded focus-within:border-blue-500">
                  <span className="text-gray-500 pl-3 text-sm">/</span>
                  <input
                    type="text"
                    value={draft.route}
                    onChange={(e) => updateDraft({ route: e.target.value })}
                    placeholder="myband"
                    className="flex-1 bg-transparent px-1 py-2 text-gray-100 font-mono text-sm focus:outline-none"
                  />
                </div>
              </label>
            </div>

            {/* Logo */}
            <div className="space-y-2">
              <span className="text-sm text-gray-400">Logo (optional)</span>
              <div className="flex items-center gap-4">
                {draft.logo ? (
                  <div className="relative group">
                    <img
                      src={draft.logo + (logoCacheBust ? `?v=${logoCacheBust}` : '')}
                      alt="Band logo"
                      className="w-16 h-16 rounded object-contain bg-gray-800 border border-gray-600"
                    />
                    <button
                      onClick={removeLogo}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 hover:bg-red-500 rounded-full text-xs text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      &times;
                    </button>
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded bg-gray-800 border border-dashed border-gray-600 flex items-center justify-center text-gray-500 text-xs">
                    No logo
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo || !draft.id}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded text-sm"
                  >
                    {uploadingLogo ? 'Uploading...' : draft.logo ? 'Replace Logo' : 'Upload Logo'}
                  </button>
                  <span className="text-xs text-gray-500">PNG, JPEG, or SVG</span>
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
              </div>
            </div>

            {/* Colors */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-300">Color Scheme</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {(Object.keys(defaultColors) as (keyof BandColors)[]).map((key) => (
                  <label key={key} className="space-y-1">
                    <span className="text-xs text-gray-400 capitalize">{key}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={draft.colors[key]}
                        onChange={(e) => updateColor(key, e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                      />
                      <input
                        type="text"
                        value={draft.colors[key]}
                        onChange={(e) => updateColor(key, e.target.value)}
                        className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </label>
                ))}
              </div>

              {/* Preview */}
              <div
                className="rounded-lg p-4 border border-gray-600"
                style={{ backgroundColor: draft.colors.background }}
              >
                <span
                  className="text-sm font-semibold"
                  style={{ color: draft.colors.text }}
                >
                  {draft.name || 'Band Name'}
                </span>
                <div className="flex gap-2 mt-2">
                  <span
                    className="px-2 py-1 rounded text-xs font-medium"
                    style={{ backgroundColor: draft.colors.primary, color: draft.colors.text }}
                  >
                    Primary
                  </span>
                  <span
                    className="px-2 py-1 rounded text-xs font-medium"
                    style={{ backgroundColor: draft.colors.accent, color: draft.colors.background }}
                  >
                    Accent
                  </span>
                </div>
              </div>
            </div>

            {/* Song selection */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-300">
                Songs ({draft.songIds.length} selected)
              </h3>
              {allSongs.length === 0 ? (
                <p className="text-sm text-gray-500">No songs in manifest.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {allSongs.map((song) => {
                    const selected = draft.songIds.includes(song.id);
                    return (
                      <button
                        key={song.id}
                        onClick={() => toggleSong(song.id)}
                        className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                          selected
                            ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                            : 'border-gray-600 text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        {song.title} — {song.artist}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={saving || !draft.name || !draft.id || !draft.route}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
              >
                {saving ? 'Saving...' : editingIndex !== null ? 'Update Band' : 'Add Band'}
              </button>
              <button
                onClick={cancelEdit}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function ColorDot({ color, label }: { color: string; label: string }) {
  return (
    <div
      className="w-4 h-4 rounded-full border border-gray-600"
      style={{ backgroundColor: color }}
      title={label}
    />
  );
}

function nameToSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function nameToRoute(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

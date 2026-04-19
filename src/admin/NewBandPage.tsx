import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBandStore } from '../store/bandStore';
import { bandsManifestSchema } from '../config/schema';
import { r2Url } from '../utils/url';
import { generateUniqueBandId } from '../utils/bandId';
import type { BandColors, BandConfig } from '../audio/types';

const defaultColors: BandColors = {
  primary: '#3b82f6',
  accent: '#f59e0b',
  background: '#111827',
  text: '#f3f4f6',
};

function nameToSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function NewBandPage() {
  const navigate = useNavigate();
  const bandsManifest = useBandStore((s) => s.bandsManifest);
  const setBandsManifest = useBandStore((s) => s.setBandsManifest);

  const [bands, setBands] = useState<BandConfig[]>(bandsManifest?.bands ?? []);
  const [draft, setDraft] = useState<BandConfig>(() => ({
    id: generateUniqueBandId(new Set((bandsManifest?.bands ?? []).map((b) => b.id))),
    name: '',
    route: '',
    colors: { ...defaultColors },
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeDirty, setRouteDirty] = useState(false);
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const [localLogoUrl, setLocalLogoUrl] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Load the manifest if we don't have it yet (direct navigation to /admin/new-band).
  // If the draft's id happens to collide with a late-loaded existing id, regenerate.
  useEffect(() => {
    const applyBands = (list: BandConfig[]) => {
      setBands(list);
      setDraft((d) => {
        if (!list.some((b) => b.id === d.id)) return d;
        return { ...d, id: generateUniqueBandId(new Set(list.map((b) => b.id))) };
      });
    };
    if (bandsManifest) {
      applyBands(bandsManifest.bands);
      return;
    }
    fetch(r2Url('registry.json'))
      .then((r) => r.json())
      .then((data) => {
        const parsed = bandsManifestSchema.parse(data);
        setBandsManifest(parsed);
        applyBands(parsed.bands);
      })
      .catch((err) => setError(String(err)));
  }, [bandsManifest, setBandsManifest]);

  const updateDraft = (updates: Partial<BandConfig>) => {
    setDraft((d) => ({ ...d, ...updates }));
  };

  const updateColor = (key: keyof BandColors, value: string) => {
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }));
  };

  const handleNameChange = (name: string) => {
    const updates: Partial<BandConfig> = { name };
    if (!routeDirty) updates.route = nameToSlug(name);
    updateDraft(updates);
  };

  const handleRouteChange = (route: string) => {
    setRouteDirty(true);
    updateDraft({ route });
  };

  const handleLogoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (localLogoUrl) URL.revokeObjectURL(localLogoUrl);
    setPendingLogoFile(file);
    setLocalLogoUrl(URL.createObjectURL(file));
    updateDraft({ logo: undefined });
  };

  const removeLogo = () => {
    if (localLogoUrl) URL.revokeObjectURL(localLogoUrl);
    setPendingLogoFile(null);
    setLocalLogoUrl(null);
    updateDraft({ logo: undefined });
  };

  useEffect(() => {
    return () => {
      if (localLogoUrl) URL.revokeObjectURL(localLogoUrl);
    };
  }, [localLogoUrl]);

  const handleSave = async () => {
    if (!draft.name || !draft.route) {
      setError('Name and route are required');
      return;
    }
    if (bands.some((b) => b.route === draft.route)) {
      setError(`Route "${draft.route}" is already taken`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Silently regenerate id if it collides with an existing band — the id is
      // backend-only, so the user shouldn't be asked to resolve this.
      const existingIds = new Set(bands.map((b) => b.id));
      const safeId = existingIds.has(draft.id)
        ? generateUniqueBandId(existingIds)
        : draft.id;
      let finalDraft: BandConfig = { ...draft, id: safeId };

      if (pendingLogoFile) {
        const formData = new FormData();
        formData.append('logo', pendingLogoFile, pendingLogoFile.name);
        const uploadRes = await fetch(`/api/bands/${finalDraft.id}/logo`, {
          method: 'POST',
          body: formData,
        });
        if (!uploadRes.ok) {
          const body = await uploadRes.json();
          throw new Error(body.error ?? 'Logo upload failed');
        }
        const { path: logoPath } = await uploadRes.json();
        finalDraft = { ...finalDraft, logo: logoPath };
      }

      const updated = [...bands, finalDraft];
      const res = await fetch('/api/bands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bands: updated }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Save failed');
      }
      setBandsManifest({ bands: updated });
      navigate(`/${finalDraft.route}`);
    } catch (err: any) {
      setError(err.message ?? 'Save failed');
      setSaving(false);
    }
  };

  const colorKeys: (keyof BandColors)[] = ['primary', 'accent', 'background', 'text'];

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="px-4 py-3 border-b border-gray-700 flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          &larr; Back
        </button>
        <h1 className="text-lg font-semibold">New Band</h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <label className="block">
          <span className="text-sm text-gray-400">Name</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="My Band"
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
            autoFocus
          />
        </label>

        <label className="block">
          <span className="text-sm text-gray-400">Route</span>
          <div className="mt-1 flex items-center bg-gray-800 border border-gray-600 rounded focus-within:border-blue-500">
            <span className="text-gray-500 pl-3 text-sm">/</span>
            <input
              type="text"
              value={draft.route}
              onChange={(e) => handleRouteChange(e.target.value)}
              placeholder="myband"
              className="flex-1 bg-transparent px-1 py-2 text-gray-100 font-mono text-sm focus:outline-none"
            />
          </div>
        </label>

        <div className="space-y-2">
          <span className="text-sm text-gray-400">Logo (optional)</span>
          <div className="flex items-center gap-4">
            {localLogoUrl ? (
              <div className="relative group">
                <img
                  src={localLogoUrl}
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
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                {localLogoUrl ? 'Replace Logo' : 'Upload Logo'}
              </button>
              <span className="text-xs text-gray-500">PNG, JPEG, or SVG</span>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
              onChange={handleLogoPick}
              className="hidden"
            />
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium text-gray-300">Color Scheme</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {colorKeys.map((key) => (
              <label key={key} className="space-y-1">
                <span className="text-xs text-gray-400 capitalize">{key}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.colors[key]}
                    onChange={(e) => updateColor(key, e.target.value)}
                    className="w-10 h-10 shrink-0 rounded cursor-pointer bg-transparent border-0"
                  />
                  <input
                    type="text"
                    value={draft.colors[key]}
                    onChange={(e) => updateColor(key, e.target.value)}
                    className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs font-mono text-gray-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </label>
            ))}
          </div>

          <div
            className="flex items-center gap-4 p-4 min-h-[56px] rounded-lg border border-gray-700"
            style={{ backgroundColor: draft.colors.background }}
          >
            {localLogoUrl ? (
              <img
                src={localLogoUrl}
                alt=""
                className="h-16 object-contain shrink-0"
              />
            ) : (
              <div
                className="w-16 h-16 rounded flex items-center justify-center text-2xl font-bold shrink-0"
                style={{ backgroundColor: draft.colors.primary, color: draft.colors.text }}
              >
                {(draft.name || 'My Band')[0]}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-semibold" style={{ color: draft.colors.text }}>
                {draft.name || 'My Band'}
              </div>
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
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || !draft.name || !draft.route}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
          >
            {saving ? 'Creating...' : 'Create Band'}
          </button>
          <button
            onClick={() => navigate('/')}
            disabled={saving}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-sm"
          >
            Cancel
          </button>
        </div>
      </main>
    </div>
  );
}

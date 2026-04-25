import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBandStore } from '../store/bandStore';
import { dedupeSlug } from '../utils/dedupeSlug';
import type { BandColors, BandConfig, BandIndexEntry } from '../audio/types';

function nameToSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

interface Props {
  band: BandConfig;
  onClose: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function EditBandModal({ band, onClose }: Props) {
  const bandsManifest = useBandStore((s) => s.bandsManifest);
  const setBandsManifest = useBandStore((s) => s.setBandsManifest);
  const setCurrentBand = useBandStore((s) => s.setCurrentBand);
  const navigate = useNavigate();

  const [draft, setDraft] = useState<BandConfig>({
    ...band,
    colors: { ...band.colors },
  });
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoCacheBust, setLogoCacheBust] = useState(0);
  const [storage, setStorage] = useState<{ totalBytes: number; objectCount: number } | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bands/${band.id}/storage`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.totalBytes === 'number') {
          setStorage(data);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [band.id]);

  // Live-preview draft colors on the page's CSS variables.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--band-primary', draft.colors.primary);
    root.style.setProperty('--band-accent', draft.colors.accent);
    root.style.setProperty('--band-bg', draft.colors.background);
    root.style.setProperty('--band-text', draft.colors.text);
  }, [draft.colors.primary, draft.colors.accent, draft.colors.background, draft.colors.text]);

  // On unmount, reapply colors from the (possibly updated) current band so a
  // cancelled edit reverts and a saved edit keeps the new colors.
  useEffect(() => {
    return () => {
      const current = useBandStore.getState().currentBand;
      if (!current) return;
      const root = document.documentElement;
      root.style.setProperty('--band-primary', current.colors.primary);
      root.style.setProperty('--band-accent', current.colors.accent);
      root.style.setProperty('--band-bg', current.colors.background);
      root.style.setProperty('--band-text', current.colors.text);
    };
  }, []);

  const takenRoutes = useMemo(
    () =>
      new Set(
        (bandsManifest?.bands ?? []).filter((b) => b.id !== band.id).map((b) => b.route),
      ),
    [bandsManifest, band.id],
  );
  const routeCollides = !!draft.route && takenRoutes.has(nameToSlug(draft.route));

  const updateDraft = (updates: Partial<BandConfig>) => {
    setDraft((d) => ({ ...d, ...updates }));
  };

  const updateColor = (key: keyof BandColors, value: string) => {
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }));
  };

  const addPaletteColor = (color: string) => {
    setDraft((d) => ({ ...d, palette: [...(d.palette ?? []), color] }));
  };

  const updatePaletteColor = (index: number, color: string) => {
    setDraft((d) => ({
      ...d,
      palette: (d.palette ?? []).map((c, i) => (i === index ? color : c)),
    }));
  };

  const removePaletteColor = (index: number) => {
    setDraft((d) => ({
      ...d,
      palette: (d.palette ?? []).filter((_, i) => i !== index),
    }));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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

  const removeLogo = () => updateDraft({ logo: undefined });

  const handleSave = async () => {
    if (!draft.name || !draft.route) {
      setError('Name and route are required');
      return;
    }
    if (!bandsManifest) {
      setError('Bands manifest not loaded');
      return;
    }

    const dupeRoute = bandsManifest.bands.some(
      (b) => b.route === draft.route && b.id !== draft.id,
    );
    if (dupeRoute) {
      setError(`Route "${draft.route}" is already taken`);
      return;
    }

    setSaving(true);
    setError(null);

    // Normalize empty website to undefined so we don't persist "" in band.json.
    const trimmedWebsite = draft.website?.trim();
    const toSave: BandConfig = { ...draft, website: trimmedWebsite ? trimmedWebsite : undefined };

    try {
      const res = await fetch(`/api/bands/${toSave.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSave),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Save failed');
      }

      const indexEntry: BandIndexEntry = {
        id: toSave.id,
        name: toSave.name,
        route: toSave.route,
        background: toSave.colors.background,
        text: toSave.colors.text,
        ...(toSave.logo ? { logo: toSave.logo } : {}),
      };
      setBandsManifest({
        bands: bandsManifest.bands.map((b) => (b.id === toSave.id ? indexEntry : b)),
      });
      setCurrentBand(toSave);
      onClose();
      if (toSave.route !== band.route) {
        navigate(`/${toSave.route}`, { replace: true });
      }
    } catch (err: any) {
      setError(err.message ?? 'Save failed');
      setSaving(false);
    }
  };

  const colorKeys: (keyof BandColors)[] = ['primary', 'accent', 'background', 'text'];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="relative flex items-center justify-between px-5 py-2">
        <h2 className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-gray-100 pointer-events-none">
          Edit Band
        </h2>
        <div className="flex items-center gap-4">
          {error && <span className="text-xs text-red-400">{error}</span>}
          {storage && (
            <span className="text-xs text-gray-500">
              {formatBytes(storage.totalBytes)} · {storage.objectCount} files
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white transition-colors"
            onClick={handleSave}
            disabled={saving || !draft.name || !draft.route || routeCollides}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors"
            onClick={onClose}
            disabled={saving}
          >
            Close
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="overflow-y-auto overflow-x-hidden mt-3 max-w-3xl w-full mx-auto rounded-lg border border-gray-700 p-5 space-y-5 mb-5" style={{ maxHeight: 'clamp(200px, 55vh, 560px)' }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="space-y-1">
            <span className="text-xs text-gray-400">Name</span>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => updateDraft({ name: e.target.value })}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-400">Route</span>
            <div className={`flex items-center bg-gray-800 border rounded focus-within:border-blue-500 ${routeCollides ? 'border-red-500' : 'border-gray-600'}`}>
              <span className="text-gray-500 pl-3 text-sm">/</span>
              <input
                type="text"
                value={draft.route}
                onChange={(e) => updateDraft({ route: e.target.value })}
                className="flex-1 bg-transparent px-1 py-2 text-gray-100 font-mono text-sm focus:outline-none"
                placeholder={dedupeSlug(nameToSlug(draft.name) || 'myband', takenRoutes)}
              />
            </div>
            {routeCollides && (
              <p className="text-xs text-red-400">This route is already taken by another band.</p>
            )}
          </label>
        </div>

        <div className="flex items-start gap-6">
          <div className="space-y-2 shrink-0">
            <span className="text-xs text-gray-400">Logo</span>
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
                  disabled={uploadingLogo}
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

          <label className="flex-1 min-w-0 space-y-1">
            <span className="text-xs text-gray-400">Website</span>
            <input
              type="url"
              value={draft.website ?? ''}
              onChange={(e) => updateDraft({ website: e.target.value })}
              placeholder="https://example.com"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            />
            <span className="block text-xs text-gray-500">Opens in a new tab when the user clicks the band logo (or name, if no logo is set).</span>
          </label>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-medium text-gray-300">Color Scheme</span>
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
        </div>

        <div className="space-y-2">
          <span className="text-xs font-medium text-gray-300">Saved Colors</span>
          <div className="flex flex-wrap gap-3 items-start">
            {(draft.palette ?? []).map((color, i) => (
              <div key={i} className="relative group">
                <label className="flex flex-col items-center gap-1 cursor-pointer">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => updatePaletteColor(i, e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer bg-transparent border-0 block"
                  />
                  <span className="text-[10px] font-mono text-gray-500 leading-none">
                    {color}
                  </span>
                </label>
                <button
                  onClick={() => removePaletteColor(i)}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 hover:bg-red-500 rounded-full text-xs text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove color"
                >
                  &times;
                </button>
              </div>
            ))}
            <div className="flex flex-col items-center gap-1">
              <label className="relative w-10 h-10 rounded border-2 border-dashed border-gray-600 text-gray-500 hover:border-gray-400 hover:text-gray-300 flex items-center justify-center transition-colors cursor-pointer">
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <input
                  key={(draft.palette ?? []).length}
                  type="color"
                  onChange={(e) => addPaletteColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label="Add color"
                />
              </label>
              <span className="text-[10px] font-mono invisible leading-none">#000000</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

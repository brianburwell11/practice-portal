import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBandStore } from '../store/bandStore';
import type { BandColors, BandConfig, BandIndexEntry } from '../audio/types';

interface Props {
  band: BandConfig;
  onClose: () => void;
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
  const logoInputRef = useRef<HTMLInputElement>(null);

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

  const updateDraft = (updates: Partial<BandConfig>) => {
    setDraft((d) => ({ ...d, ...updates }));
  };

  const updateColor = (key: keyof BandColors, value: string) => {
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }));
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

    try {
      const res = await fetch(`/api/bands/${draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Save failed');
      }

      const indexEntry: BandIndexEntry = {
        id: draft.id,
        name: draft.name,
        route: draft.route,
        background: draft.colors.background,
        text: draft.colors.text,
        ...(draft.logo ? { logo: draft.logo } : {}),
      };
      setBandsManifest({
        bands: bandsManifest.bands.map((b) => (b.id === draft.id ? indexEntry : b)),
      });
      setCurrentBand(draft);
      onClose();
      if (draft.route !== band.route) {
        navigate(`/${draft.route}`, { replace: true });
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
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white transition-colors"
            onClick={handleSave}
            disabled={saving || !draft.name || !draft.route}
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
            <div className="flex items-center bg-gray-800 border border-gray-600 rounded focus-within:border-blue-500">
              <span className="text-gray-500 pl-3 text-sm">/</span>
              <input
                type="text"
                value={draft.route}
                onChange={(e) => updateDraft({ route: e.target.value })}
                className="flex-1 bg-transparent px-1 py-2 text-gray-100 font-mono text-sm focus:outline-none"
              />
            </div>
          </label>
        </div>

        <div className="space-y-2">
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
      </div>
    </div>
  );
}

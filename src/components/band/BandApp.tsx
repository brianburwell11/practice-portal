import { useEffect, useState } from 'react';
import { useParams, Outlet } from 'react-router-dom';
import { useBandStore } from '../../store/bandStore';
import { bandsManifestSchema } from '../../config/schema';
import { r2Url } from '../../utils/url';

export function BandApp() {
  const { bandSlug } = useParams<{ bandSlug: string }>();
  const { bandsManifest, setBandsManifest, setCurrentBand } = useBandStore();
  const [error, setError] = useState<string | null>(null);

  // Load bands manifest
  useEffect(() => {
    if (bandsManifest) return;
    fetch(r2Url('registry.json'))
      .then((r) => r.json())
      .then((data) => setBandsManifest(bandsManifestSchema.parse(data)))
      .catch((err) => setError(String(err)));
  }, [bandsManifest, setBandsManifest]);

  // Resolve current band from slug
  useEffect(() => {
    if (!bandsManifest || !bandSlug) return;
    const band = bandsManifest.bands.find((b) => b.route === bandSlug);
    if (band) {
      setCurrentBand(band);
    } else {
      setError(`Band not found: ${bandSlug}`);
    }
  }, [bandsManifest, bandSlug, setCurrentBand]);

  const currentBand = useBandStore((s) => s.currentBand);

  // Apply band CSS variables
  useEffect(() => {
    if (!currentBand) return;
    const root = document.documentElement;
    root.style.setProperty('--band-primary', currentBand.colors.primary);
    root.style.setProperty('--band-accent', currentBand.colors.accent);
    root.style.setProperty('--band-bg', currentBand.colors.background);
    root.style.setProperty('--band-text', currentBand.colors.text);
    document.title = `${currentBand.name} Practice Portal`;
    return () => {
      root.style.removeProperty('--band-primary');
      root.style.removeProperty('--band-accent');
      root.style.removeProperty('--band-bg');
      root.style.removeProperty('--band-text');
      document.title = 'Practice Portal';
    };
  }, [currentBand]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-red-400 p-8">
        {error}
      </div>
    );
  }

  if (!currentBand) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-400 p-8">
        Loading...
      </div>
    );
  }

  return <Outlet />;
}

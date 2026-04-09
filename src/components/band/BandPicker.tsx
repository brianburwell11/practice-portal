import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useBandStore } from '../../store/bandStore';
import { bandsManifestSchema } from '../../config/schema';
import { r2Url } from '../../utils/url';

export function BandPicker() {
  const { bandsManifest, setBandsManifest } = useBandStore();

  useEffect(() => {
    if (bandsManifest) return;
    fetch(r2Url('registry.json'))
      .then((r) => r.json())
      .then((data) => setBandsManifest(bandsManifestSchema.parse(data)))
      .catch(console.error);
  }, [bandsManifest, setBandsManifest]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-2">Practice Portal</h1>
      <p className="text-gray-400 mb-10">Select your band to get started.</p>

      {!bandsManifest ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="grid gap-4 w-full max-w-md">
          {bandsManifest.bands.map((band) => (
            <Link
              key={band.id}
              to={`/${band.route}`}
              className="flex items-center gap-4 p-4 min-h-[56px] rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
              style={{ backgroundColor: band.colors.background }}
            >
              {band.logo ? (
                <img src={band.logo} alt="" className="w-10 h-10 rounded object-contain" />
              ) : (
                <div
                  className="w-10 h-10 rounded flex items-center justify-center text-lg font-bold"
                  style={{ backgroundColor: band.colors.primary, color: band.colors.text }}
                >
                  {band.name[0]}
                </div>
              )}
              <div>
                <div className="font-semibold" style={{ color: band.colors.text }}>
                  {band.name}
                </div>
                <div className="text-sm text-gray-400">
                  {band.songIds.length} {band.songIds.length === 1 ? 'song' : 'songs'}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {import.meta.env.DEV && (
        <div className="mt-8 flex items-center gap-4">
          <Link
            to="/admin/bands"
            className="text-sm text-gray-500 hover:text-gray-300"
          >
            Manage Bands
          </Link>
          <Link
            to="/admin/bands?new=true"
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium text-white"
          >
            + New Band
          </Link>
        </div>
      )}
    </div>
  );
}

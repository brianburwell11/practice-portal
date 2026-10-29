import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useBandStore } from '../../store/bandStore';
import { bandsManifestSchema } from '../../config/schema';
import { dataUrl } from '../../utils/url';
import { AccountMenu } from '../account/AccountMenu';
import { LegalLinks } from '../legal/LegalPage';
import { useSessionStore } from '../../store/sessionStore';
import practicePortalMark from '../../assets/practice-portal-mark-large.png';

export function BandPicker() {
  const { bandsManifest, setBandsManifest } = useBandStore();
  const platformAdmin = useSessionStore((s) => s.platformAdmin);

  useEffect(() => {
    if (bandsManifest) return;
    fetch(dataUrl('registry.json'))
      .then((r) => r.json())
      .then((data) => setBandsManifest(bandsManifestSchema.parse(data)))
      .catch(console.error);
  }, [bandsManifest, setBandsManifest]);

  return (
    <div className="min-h-screen bg-page text-gray-100 flex flex-col items-center justify-center p-8">
      <div className="absolute top-4 right-4">
        <AccountMenu />
      </div>
      {/* The wordmark: the logo above "Practice" in white and "Portal" in the logo's blue. */}
      <h1 className="flex flex-col items-center mb-4 font-brand font-bold text-3xl sm:text-6xl tracking-tight text-center">
        <img src={practicePortalMark} alt="" className="h-16 sm:h-28 w-auto" />
        {/* No gap and a tight line box: the mark all but rests on the capitals. */}
        <span className="leading-none -mt-0.5 sm:-mt-1.5">
          <span className="text-white">Practice</span> <span className="text-brand">Portal</span>
        </span>
      </h1>
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
              style={{ backgroundColor: band.background }}
            >
              {band.logo ? (
                <img src={band.logo} alt="" className="w-10 h-10 rounded object-contain" />
              ) : (
                <div
                  className="w-10 h-10 rounded flex items-center justify-center text-lg font-bold"
                  style={{ backgroundColor: band.text, color: band.background }}
                >
                  {band.name[0]}
                </div>
              )}
              <div>
                <div className="font-semibold" style={{ color: band.text }}>
                  {band.name}
                </div>
                <div className="text-sm font-mono" style={{ color: band.text, opacity: 0.6 }}>
                  /{band.route}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {platformAdmin && (
        <div className="mt-8 flex items-center gap-4">
          <Link
            to="/admin/new-band"
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium text-white"
          >
            + New Band
          </Link>
        </div>
      )}

      <LegalLinks className="mt-12" />
    </div>
  );
}

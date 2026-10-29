import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBandStore } from '../../store/bandStore';
import { bandsManifestSchema } from '../../config/schema';
import { dataUrl } from '../../utils/url';
import { AccountMenu, GoogleMark } from '../account/AccountMenu';
import { LegalLinks } from '../legal/LegalPage';
import { signInHref, useSessionStore } from '../../store/sessionStore';
import practicePortalMark from '../../assets/practice-portal-mark-large.png';

export function BandPicker() {
  const { bandsManifest, setBandsManifest } = useBandStore();
  const { available, loaded, user, bands: memberOf } = useSessionStore();
  // With accounts, only the bands you're in: public bands aren't listed here.
  const bands = (bandsManifest?.bands ?? [])
    .filter((b) => !available || memberOf.some((m) => m.id === b.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  // Signed out on a server with accounts: what this is, and how to get in.
  const welcome = loaded && available && !user;

  const [loadFailed, setLoadFailed] = useState(false);

  const loadBands = useCallback(() => {
    fetch(dataUrl('registry.json'))
      .then((r) => {
        if (!r.ok) throw new Error(`registry.json: ${r.status}`);
        return r.json();
      })
      .then((data) => setBandsManifest(bandsManifestSchema.parse(data)))
      .catch((err) => {
        console.error('Loading bands failed', err);
        setLoadFailed(true);
      });
  }, [setBandsManifest]);

  useEffect(() => {
    if (!bandsManifest) loadBands();
  }, [bandsManifest, loadBands]);

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
      {welcome && <Welcome />}

      {welcome ? null : loadFailed ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-gray-300">Couldn’t load your bands. Check your connection and try again.</p>
          <button onClick={() => { setLoadFailed(false); loadBands(); }} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white">
            Try again
          </button>
        </div>
      ) : !bandsManifest || !loaded ? (
        <p className="text-gray-500">Loading...</p>
      ) : bands.length > 0 ? (
        <>
          <p className="text-gray-400 mb-6">Select your band to get started.</p>
          <div className="grid gap-4 w-full max-w-md">
            {bands.map((band) => (
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
        </>
      ) : (
        user && (
          <p className="text-gray-400 text-center max-w-sm">
            You’re not in a band yet. Ask someone in your band for an invite link, or start your own.
          </p>
        )
      )}

      {user && (
        <div className="mt-8 flex items-center gap-4">
          <Link
            to="/admin/new-band"
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium text-white"
          >
            + Start a band
          </Link>
        </div>
      )}

      <LegalLinks className="mt-12" />
    </div>
  );
}

const FEATURES = [
  { title: 'Every part on its own fader', body: 'Solo the bass, drop the drums, or mute your own part and play along with the band.' },
  { title: 'Charts that follow the song', body: 'Sheet music and lyrics scroll in time, so you never lose your place.' },
  { title: 'Slow it down', body: 'Work through the hard bars at your own tempo, then bring it back up to speed.' },
  { title: 'Set lists for the gig', body: 'Run the night in order, with every song ready to play.' },
];

/** The signed-out home page: what Practice Portal is, and a way to sign up. */
function Welcome() {
  return (
    <section className="w-full max-w-2xl flex flex-col items-center text-center mb-12">
      <p className="text-lg sm:text-xl text-gray-300 max-w-lg mb-8">
        Your band’s songs split into stems with the charts in sync. Practice your part anywhere between rehearsals.
      </p>
      <a
        href={signInHref()}
        className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-white text-gray-800 font-medium shadow hover:bg-gray-100"
      >
        <GoogleMark />
        Sign up with Google
      </a>
      <p className="mt-3 text-sm text-gray-500">
        Already have an account? <a href={signInHref()} className="text-gray-300 hover:text-white underline underline-offset-2">Sign in</a>
      </p>
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 w-full text-left">
        {FEATURES.map((f) => (
          <li key={f.title} className="rounded-lg border border-gray-800 bg-white/[0.03] p-4">
            <h2 className="font-semibold text-gray-100">{f.title}</h2>
            <p className="mt-1 text-sm text-gray-400">{f.body}</p>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-gray-500 max-w-md">
        Got an invite link from your band? Open it to join. You’ll sign in along the way.
      </p>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useParams, Outlet } from 'react-router-dom';
import { useBandStore } from '../../store/bandStore';
import { useSongStore } from '../../store/songStore';
import { useSetlistStore } from '../../store/setlistStore';
import { bandConfigSchema, bandsManifestSchema } from '../../config/schema';
import { dataUrl } from '../../utils/url';
import { useSessionStore } from '../../store/sessionStore';
import { AccountMenu } from '../account/AccountMenu';
import { RequestAccess } from '../account/RequestAccess';

/**
 * A band's guest link is the band's own address plus `?guest=<token>`. Open it
 * (the server sets the `pp_guest` cookie), then reload without the token, so
 * every document is fetched again as a guest and the address bar is clean.
 * Resolves to an error message if the link can't be opened.
 */
async function openGuestLink(token: string): Promise<string> {
  const res = await fetch(`/api/guest/${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => null);
  const data = await res?.json().catch(() => ({}));
  if (!res?.ok) return data?.error ?? 'This guest link isn’t valid';
  const params = new URLSearchParams(window.location.search);
  params.delete('guest');
  const qs = params.toString();
  // The token decides the band, so a link made before a route rename still lands right.
  window.location.replace(`/${data.band.slug}${qs ? `?${qs}` : ''}${window.location.hash}`);
  return new Promise(() => {}); // the page is going away
}

export function BandApp() {
  const { bandSlug } = useParams<{ bandSlug: string }>();
  const { bandsManifest, setBandsManifest, setCurrentBand } = useBandStore();
  const [error, setError] = useState<string | null>(null);
  const [guestToken] = useState(() => new URLSearchParams(window.location.search).get('guest'));
  const [guestError, setGuestError] = useState<string | null>(null);
  const guestPending = !!guestToken && guestError === null;

  // A guest link: open it before anything else loads.
  useEffect(() => {
    if (!guestToken) return;
    openGuestLink(guestToken).then((message) => {
      // It didn't open — drop the token from the address bar and carry on as before.
      const params = new URLSearchParams(window.location.search);
      params.delete('guest');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
      setGuestError(message);
    });
  }, [guestToken]);

  // Load bands manifest
  useEffect(() => {
    if (bandsManifest || guestPending) return;
    fetch(dataUrl('registry.json'))
      .then((r) => r.json())
      .then((data) => setBandsManifest(bandsManifestSchema.parse(data)))
      .catch((err) => setError(String(err)));
  }, [bandsManifest, setBandsManifest, guestPending]);

  // Resolve the slim index entry, then fetch the full band.json.
  const prevBandIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bandsManifest || !bandSlug) return;
    const indexEntry = bandsManifest.bands.find((b) => b.route === bandSlug);
    if (!indexEntry) {
      // A Members-only band is missing from the registry for anyone who
      // isn't a member, so "not found" might mean "not for you".
      setCurrentBand(null);
      setError(`Band not found: ${bandSlug}`);
      return;
    }

    // When switching to a different band, clear per-band state so stale
    // selections (song, setlist) from the previous band don't linger.
    if (prevBandIdRef.current && prevBandIdRef.current !== indexEntry.id) {
      useSongStore.getState().setSelectedSong(null);
      useSetlistStore.getState().setActiveSetlist(null);
    }
    prevBandIdRef.current = indexEntry.id;

    let cancelled = false;
    fetch(dataUrl(`${indexEntry.id}/band.json`))
      .then((r) => {
        if (!r.ok) throw new Error(`band.json fetch failed (${r.status})`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const fullBand = bandConfigSchema.parse(data);
        setCurrentBand(fullBand);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setCurrentBand(null);
        setError(`Failed to load band: ${err.message}`);
      });

    return () => {
      cancelled = true;
    };
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
    return <BandUnavailable slug={bandSlug ?? ''} error={error} guestError={guestError} />;
  }

  if (!currentBand || guestPending) {
    return (
      <div className="min-h-screen bg-page text-gray-400 p-8">
        Loading...
      </div>
    );
  }

  return <Outlet />;
}

/**
 * Where accounts exist, a band missing from the registry may be Members-only
 * rather than nonexistent — offer sign-in instead of a bare "not found".
 */
function BandUnavailable({ slug, error, guestError }: { slug: string; error: string; guestError: string | null }) {
  const { available, loaded, user, load } = useSessionStore();
  useEffect(() => {
    load();
  }, [load]);

  if (!loaded || !available || !error.startsWith('Band not found')) {
    return <div className="min-h-screen bg-page text-red-400 p-8">{loaded ? error : null}</div>;
  }

  return (
    <div className="min-h-screen bg-page text-gray-100 flex items-center justify-center p-6">
      <div className="absolute top-4 right-4"><AccountMenu /></div>
      <div className="max-w-sm text-center space-y-4">
        {guestError && <p className="text-sm text-amber-300">{guestError}</p>}
        <RequestAccess
          slug={slug}
          user={user}
          fallback={
            <>
              <h1 className="text-xl font-semibold">Band not found</h1>
              <p className="text-sm text-gray-400">There’s no band at this address.</p>
            </>
          }
        />
      </div>
    </div>
  );
}

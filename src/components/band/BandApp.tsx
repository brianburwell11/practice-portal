import { useEffect, useState } from 'react';
import { autoInk } from '../../utils/bandTheme';
import { useParams, Outlet } from 'react-router-dom';
import { useBandStore } from '../../store/bandStore';
import { useSongStore } from '../../store/songStore';
import { useSetlistStore } from '../../store/setlistStore';
import { useLyricsStore } from '../../store/lyricsStore';
import { useChordsStore } from '../../store/chordsStore';
import { useNotesStore } from '../../store/notesStore';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import { useLyricsEditorStore } from '../../store/lyricsEditorStore';
import { useChordsEditorStore } from '../../store/chordsEditorStore';
import { stopSharedEngine } from '../../hooks/useAudioEngine';
import { bandConfigSchema, bandsManifestSchema } from '../../config/schema';
import { dataUrl } from '../../utils/url';
import { useSessionStore } from '../../store/sessionStore';
import { AccountMenu } from '../account/AccountMenu';
import { RequestAccess } from '../account/RequestAccess';
import { NotFound } from '../NotFound';
import { PageLoader } from '../ui/Loading';
import { noteBandsVerified } from '../../offline/offline';
import { bandPageTitle } from '../../utils/pageTitle';

/**
 * A band's guest link is the band's own address plus `?guest=<token>`. Open it
 * (the server sets the `pp_guest` cookie), then reload without the token, so
 * every document is fetched again as a guest and the address bar is clean.
 * Resolves to why the link didn't open, and whether trying again later
 * will help (too many opens in a short while).
 */
async function openGuestLink(token: string): Promise<{ message: string; retry: boolean }> {
  const res = await fetch(`/api/guest/${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => null);
  if (res?.status === 429) {
    const minutes = Math.max(1, Math.ceil(Number(res.headers.get('Retry-After') ?? 60) / 60));
    return {
      message: `This guest link has been opened too many times in this time period. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      retry: true,
    };
  }
  const data = await res?.json().catch(() => ({}));
  if (!res?.ok) return { message: data?.error ?? 'This guest link isn’t valid', retry: false };
  const params = new URLSearchParams(window.location.search);
  params.delete('guest');
  const qs = params.toString();
  // The token decides the band, so a link made before a route rename still lands right.
  window.location.replace(`/${data.band.slug}${qs ? `?${qs}` : ''}${window.location.hash}`);
  return new Promise(() => {}); // the page is going away
}

/**
 * The band the page last showed. Module level, not a ref: switching bands
 * goes through the band picker, which unmounts BandApp, so a ref would
 * forget the old band and its song, setlist and editors would carry over.
 */
let lastBandId: string | null = null;

/** Clear everything that belongs to one band, so the next starts fresh. */
function resetBandState() {
  stopSharedEngine();
  useBandStore.getState().setCurrentBand(null);
  useSongStore.setState({ manifest: null, selectedSong: null, error: null, failedSong: null });
  useSetlistStore.setState({ index: null, activeSetlist: null, activeIndex: 0, activeTag: null });
  useLyricsStore.getState().clear();
  useChordsStore.getState().clear();
  useNotesStore.getState().clear();
  useMarkerEditorStore.getState().close();
  useLyricsEditorStore.getState().close();
  useChordsEditorStore.getState().close();
}

export function BandApp() {
  const { bandSlug } = useParams<{ bandSlug: string }>();
  const { bandsManifest, setBandsManifest, setCurrentBand } = useBandStore();
  const [error, setError] = useState<string | null>(null);
  const [guestToken] = useState(() => new URLSearchParams(window.location.search).get('guest'));
  const [guestError, setGuestError] = useState<string | null>(null);
  // Too many opens: the link itself is fine, so offer to try it again.
  const [guestRetry, setGuestRetry] = useState(false);
  const guestPending = !!guestToken && guestError === null;

  // A guest link: open it before anything else loads.
  useEffect(() => {
    if (!guestToken) return;
    openGuestLink(guestToken).then(({ message, retry }) => {
      setGuestRetry(retry);
      // It didn't open. Drop the token from the address bar (unless trying
      // again later will work) and carry on as before.
      if (retry) {
        setGuestError(message);
        return;
      }
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
      .then(async (r) => {
        const manifest = bandsManifestSchema.parse(await r.json());
        // The offline cache checks in, and drops bands no longer listed.
        noteBandsVerified(r, manifest.bands.map((b) => b.id));
        setBandsManifest(manifest);
      })
      .catch((err) => setError(String(err)));
  }, [bandsManifest, setBandsManifest, guestPending]);

  // Resolve the slim index entry, then fetch the full band.json.
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

    // A different band than last time: drop the old band's song, setlist
    // and editors, and wait for this band before showing the page.
    if (lastBandId && lastBandId !== indexEntry.id) resetBandState();
    lastBandId = indexEntry.id;

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
    root.style.setProperty('--band-accent', currentBand.colors.accent);
    root.style.setProperty('--band-bg', currentBand.colors.background);
    root.style.setProperty('--band-text', autoInk(currentBand.colors.background));
    document.title = bandPageTitle(currentBand.name);
    return () => {
      root.style.removeProperty('--band-accent');
      root.style.removeProperty('--band-bg');
      root.style.removeProperty('--band-text');
      document.title = 'Practice Portal';
    };
  }, [currentBand]);

  if (error) {
    return <BandUnavailable slug={bandSlug ?? ''} error={error} guestError={guestError} guestRetry={guestRetry} />;
  }

  if (!currentBand || guestPending) {
    return <PageLoader />;
  }

  return <Outlet />;
}

/**
 * A band the registry didn't list. Where accounts exist it may be Members-only
 * rather than missing: then the screen to sign in or ask to join. A band
 * that doesn't exist at all gets the site's 404 page.
 */
function BandUnavailable({ slug, error, guestError, guestRetry }: { slug: string; error: string; guestError: string | null; guestRetry: boolean }) {
  const { available, loaded, user, load } = useSessionStore();
  useEffect(() => {
    load();
  }, [load]);

  if (!loaded) return null;
  if (!error.startsWith('Band not found')) {
    return <div className="min-h-screen bg-page text-red-400 p-8">{error}</div>;
  }
  if (!available) return <NotFound />;

  // A guest link that's busy, not a band they can't see: no sign-in wall.
  if (guestError && guestRetry) {
    return (
      <div className="theme-default min-h-screen bg-page text-gray-100 flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <h1 className="text-lg font-semibold">Guest link is busy</h1>
          <p className="text-sm text-gray-300">{guestError}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <RequestAccess
      slug={slug}
      user={user}
      fallback={<NotFound />}
      frame={(node) => (
        <div className="theme-default min-h-screen bg-page text-gray-100 flex items-center justify-center p-6">
          <div className="absolute top-4 right-4"><AccountMenu /></div>
          <div className="max-w-sm text-center space-y-4">
            {guestError && <p className="text-sm text-amber-300">{guestError}</p>}
            {node}
          </div>
        </div>
      )}
    />
  );
}

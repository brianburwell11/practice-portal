import { Link } from 'react-router-dom';
import { useBandStore } from '../../store/bandStore';
import { useCan } from '../../store/sessionStore';
import { useSongStore } from '../../store/songStore';
import { useSongLoader } from './SongList';

/**
 * What fills the screen before a song is playing: a failed load and its
 * Retry, a band with no songs yet (and, for those who can, how to add one),
 * or a prompt to pick a song.
 */
export function NoSongState({ onInvite }: { onInvite: () => void }) {
  const { handleSelect } = useSongLoader();
  const manifest = useSongStore((s) => s.manifest);
  const loading = useSongStore((s) => s.loading);
  const error = useSongStore((s) => s.error);
  const failedSong = useSongStore((s) => s.failedSong);
  const bandRoute = useBandStore((s) => s.currentBand?.route);
  const canAddSong = useCan('song.create');
  const canInvite = useCan('member.invite');

  if (error) {
    return (
      <Centered>
        <p className="text-gray-300">{error}</p>
        <button
          onClick={() => (failedSong ? handleSelect(failedSong) : window.location.reload())}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium text-white"
        >
          {loading ? 'Loading…' : 'Try again'}
        </button>
      </Centered>
    );
  }

  if (!manifest || loading) return <Centered><p className="text-gray-500">Loading…</p></Centered>;

  if (manifest.songs.length === 0) {
    if (!canAddSong) {
      return (
        <Centered>
          <p className="text-gray-300">No songs yet.</p>
          <p className="text-sm text-gray-500">When the band adds songs, they’ll show up here.</p>
        </Centered>
      );
    }
    return (
      <Centered>
        <h2 className="text-xl font-semibold text-gray-100">Add your first song</h2>
        <p className="text-sm text-gray-400 max-w-sm">
          Upload a song’s stems, one audio file per part, and add sheet music if you have it.
          Your band can then practice along with every part.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to={`/${bandRoute}/admin/add-song`}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white"
          >
            + Add a song
          </Link>
          {canInvite && (
            <button onClick={onInvite} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-100">
              Invite your band
            </button>
          )}
        </div>
      </Centered>
    );
  }

  return <Centered><p className="text-gray-500">Pick a song to get started.</p></Centered>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">{children}</div>;
}

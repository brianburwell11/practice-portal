import { useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { useBandStore } from '../../store/bandStore';
import { useSetlistStore } from '../../store/setlistStore';

interface Props {
  songId: string;
  songTitle: string;
  onClose: () => void;
}

export function DeleteSongModal({ songId, songTitle, onClose }: Props) {
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setManifest = useSongStore((s) => s.setManifest);
  const setSelectedSong = useSongStore((s) => s.setSelectedSong);
  const manifest = useSongStore((s) => s.manifest);
  const currentBand = useBandStore((s) => s.currentBand);
  const activeSetlist = useSetlistStore((s) => s.activeSetlist);
  const setActiveSetlist = useSetlistStore((s) => s.setActiveSetlist);

  const expected = `delete ${songId}`;
  const canDelete = confirmation === expected && !deleting;

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/bands/${currentBand!.id}/songs/${songId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Delete failed');
      }

      // Update local stores
      if (manifest) {
        setManifest({ songs: manifest.songs.filter((s) => s.id !== songId) });
      }
      setSelectedSong(null);

      if (activeSetlist) {
        setActiveSetlist({
          ...activeSetlist,
          entries: activeSetlist.entries.filter(
            (e) => !(e.type === 'song' && e.songId === songId),
          ),
        });
      }

      onClose();
    } catch (err: any) {
      setError(err.message);
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
      onKeyDown={(e) => e.stopPropagation()}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-red-400">Delete Song</h2>

        <div className="text-sm text-gray-300 space-y-2">
          <p>
            This will permanently delete the song <span className="font-semibold text-gray-100">{songTitle}</span> and all of its data.
          </p>
          <p className="text-red-400 font-medium">This action is irreversible.</p>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Type <span className="font-mono text-gray-300">{expected}</span> to confirm:
          </label>
          <input
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-red-500"
            placeholder={expected}
            autoFocus
            disabled={deleting}
          />
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!canDelete}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
          >
            {deleting ? 'Deleting...' : 'Delete Forever'}
          </button>
        </div>
      </div>
    </div>
  );
}

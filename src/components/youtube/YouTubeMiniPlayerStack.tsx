import { useCallback, useState } from 'react';
import { YouTubeMiniPlayer } from './YouTubeMiniPlayer';
import { useSongStore } from '../../store/songStore';
import type { Video } from '../../audio/types';

const MAX_VIDEOS = 4;
const PLAYER_W = 340;
const PLAYER_H = 220;
const CASCADE = 24;

interface Props {
  videos: Video[];
  admin?: boolean;
  bandId?: string;
}

export function YouTubeMiniPlayerStack({ videos, admin = false, bandId }: Props) {
  const [order, setOrder] = useState<string[]>([]);

  const limited = videos.slice(0, MAX_VIDEOS);

  const bringToFront = (id: string) => {
    setOrder((prev) => [id, ...prev.filter((x) => x !== id)]);
  };

  const zIndexFor = (id: string) => {
    const idx = order.indexOf(id);
    return idx === -1 ? 100 : 100 + (order.length - idx);
  };

  const saveOffsetFor = useCallback(
    async (videoStableId: string, offset: number) => {
      const current = useSongStore.getState().selectedSong;
      if (!current || !bandId) throw new Error('No song loaded');
      const updatedVideos = (current.videos ?? []).map((v) =>
        v.id === videoStableId ? { ...v, offsetSeconds: offset } : v,
      );
      const updated = { ...current, videos: updatedVideos };
      const res = await fetch(`/api/bands/${bandId}/songs/${current.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to save offset');
      }
      useSongStore.getState().setSelectedSong(updated);
    },
    [bandId],
  );

  return (
    <>
      {limited.map((video, i) => {
        const defaultX = window.innerWidth - PLAYER_W - i * CASCADE;
        const defaultY = window.innerHeight - PLAYER_H - i * CASCADE;
        return (
          <YouTubeMiniPlayer
            key={video.id}
            videoId={video.videoId}
            title={video.title}
            offsetSeconds={video.offsetSeconds}
            defaultX={Math.max(0, defaultX)}
            defaultY={Math.max(0, defaultY)}
            zIndex={zIndexFor(video.id)}
            admin={admin}
            onBringToFront={() => bringToFront(video.id)}
            onSaveOffset={admin && bandId ? (off) => saveOffsetFor(video.id, off) : undefined}
          />
        );
      })}
    </>
  );
}

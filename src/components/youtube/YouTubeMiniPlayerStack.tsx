import { useState } from 'react';
import { YouTubeMiniPlayer } from './YouTubeMiniPlayer';
import type { Video } from '../../audio/types';

const MAX_VIDEOS = 4;
const PLAYER_W = 340;
const PLAYER_H = 220;
const CASCADE = 24;

interface Props {
  videos: Video[];
}

export function YouTubeMiniPlayerStack({ videos }: Props) {
  const [order, setOrder] = useState<string[]>([]);

  const limited = videos.slice(0, MAX_VIDEOS);

  const bringToFront = (id: string) => {
    setOrder((prev) => [id, ...prev.filter((x) => x !== id)]);
  };

  const zIndexFor = (id: string) => {
    const idx = order.indexOf(id);
    return idx === -1 ? 100 : 100 + (order.length - idx);
  };

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
            onBringToFront={() => bringToFront(video.id)}
          />
        );
      })}
    </>
  );
}

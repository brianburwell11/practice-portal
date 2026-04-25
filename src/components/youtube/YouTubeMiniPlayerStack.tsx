import { useCallback, useState } from 'react';
import { YouTubeMiniPlayer } from './YouTubeMiniPlayer';
import { useSongStore } from '../../store/songStore';
import type { Video } from '../../audio/types';

const MAX_VIDEOS = 4;
const PLAYER_W = 320;
const PLAYER_H = 204;
const BOTTOM_PADDING = 16;
const TOOLBAR_HEIGHT = 40;

interface Props {
  videos: Video[];
  admin?: boolean;
  bandId?: string;
}

export function YouTubeMiniPlayerStack({ videos, admin = false, bandId }: Props) {
  const [order, setOrder] = useState<string[]>([]);
  const [minimized, setMinimized] = useState<Set<string>>(() => new Set());

  const limited = videos.slice(0, MAX_VIDEOS);
  const anyMinimized = minimized.size > 0;

  const bringToFront = (id: string) => {
    setOrder((prev) => [id, ...prev.filter((x) => x !== id)]);
  };

  const zIndexFor = (id: string) => {
    const idx = order.indexOf(id);
    return idx === -1 ? 100 : 100 + (order.length - idx);
  };

  const minimize = (id: string) => {
    setMinimized((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const restore = (id: string) => {
    setMinimized((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    bringToFront(id);
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

  // Reserve the toolbar's footprint when one or more videos are
  // minimized so newly-mounted players don't sit behind it.
  const toolbarReserve = anyMinimized ? TOOLBAR_HEIGHT : 0;
  const count = limited.length;
  const totalWidth = count * PLAYER_W;
  const gap = Math.max(0, (window.innerWidth - totalWidth) / (count + 1));
  const maxX = Math.max(0, window.innerWidth - PLAYER_W);
  const defaultY = Math.max(
    0,
    window.innerHeight - PLAYER_H - BOTTOM_PADDING - toolbarReserve,
  );

  const minimizedVideos = limited.filter((v) => minimized.has(v.id));

  return (
    <>
      {limited.map((video, i) => {
        const rawX = gap + i * (PLAYER_W + gap);
        const defaultX = Math.min(Math.max(0, rawX), maxX);
        return (
          <YouTubeMiniPlayer
            key={video.id}
            videoId={video.videoId}
            title={video.title}
            offsetSeconds={video.offsetSeconds}
            defaultX={defaultX}
            defaultY={defaultY}
            zIndex={zIndexFor(video.id)}
            admin={admin}
            minimized={minimized.has(video.id)}
            onBringToFront={() => bringToFront(video.id)}
            onMinimize={() => minimize(video.id)}
            onSaveOffset={admin && bandId ? (off) => saveOffsetFor(video.id, off) : undefined}
          />
        );
      })}
      {anyMinimized && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            height: TOOLBAR_HEIGHT,
            background: '#0f172a',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            overflowX: 'auto',
            zIndex: 200,
          }}
        >
          <span style={{ fontSize: 11, color: '#64748b', letterSpacing: 0.5, flexShrink: 0 }}>
            Minimized
          </span>
          {minimizedVideos.map((video) => (
            <button
              key={video.id}
              type="button"
              onClick={() => restore(video.id)}
              title={`Restore ${video.title || video.videoId}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 4,
                padding: '2px 8px 2px 2px',
                cursor: 'pointer',
                color: '#e2e8f0',
                fontSize: 12,
                flexShrink: 0,
                maxWidth: 220,
                height: 28,
              }}
            >
              <img
                src={`https://img.youtube.com/vi/${video.videoId}/default.jpg`}
                alt=""
                style={{ width: 40, height: 24, objectFit: 'cover', borderRadius: 2 }}
              />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {video.title || video.videoId}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

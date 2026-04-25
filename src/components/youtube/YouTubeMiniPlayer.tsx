import { useRef, useState } from 'react';
import { YouTubeIframe, type YouTubeIframeHandle } from './YouTubeIframe';
import { useYouTubeSync } from '../../youtube/useYouTubeSync';
import { useTransportStore } from '../../store/transportStore';

interface Props {
  videoId: string;
  title?: string;
  offsetSeconds: number;
  defaultX: number;
  defaultY: number;
  zIndex: number;
  onBringToFront: () => void;
}

const WIDTH = 320;
const HEIGHT = 180;
const HEADER = 24;

export function YouTubeMiniPlayer({
  videoId,
  title,
  offsetSeconds,
  defaultX,
  defaultY,
  zIndex,
  onBringToFront,
}: Props) {
  const [pos, setPos] = useState({ x: defaultX, y: defaultY });
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);
  const playerRef = useRef<YouTubeIframeHandle>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const songPosition = useTransportStore((s) => s.position);
  const inWaitWindow = offsetSeconds < 0 && songPosition + offsetSeconds < 0;

  useYouTubeSync(playerRef.current, ready, offsetSeconds);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    onBringToFront();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: pos.x,
      baseY: pos.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos({ x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      if (next) playerRef.current?.mute();
      else playerRef.current?.unMute();
      return next;
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: WIDTH,
        height: HEIGHT + HEADER,
        zIndex,
        background: '#000',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}
      onPointerDown={onBringToFront}
    >
      <div
        style={{
          height: HEADER,
          background: '#1f2937',
          color: '#d1d5db',
          fontSize: 11,
          padding: '0 6px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title || videoId}
        </span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggleMute();
          }}
          aria-label={muted ? 'Unmute' : 'Mute'}
          title={muted ? 'Unmute' : 'Mute'}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#9ca3af',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {muted ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </button>
      </div>
      <YouTubeIframe
        ref={playerRef}
        videoId={videoId}
        width={WIDTH}
        height={HEIGHT}
        muted={muted}
        onReady={() => setReady(true)}
      />
      {inWaitWindow && (
        <>
          <img
            src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
            alt=""
            style={{
              position: 'absolute',
              top: HEADER,
              left: 0,
              width: WIDTH,
              height: HEIGHT,
              objectFit: 'cover',
              pointerEvents: 'none',
              filter: 'grayscale(1) brightness(0.45)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: HEADER,
              left: 0,
              width: WIDTH,
              height: HEIGHT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#e5e7eb',
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: 0.5,
              textShadow: '0 1px 3px rgba(0,0,0,0.9)',
              pointerEvents: 'none',
            }}
          >
            starts in {Math.ceil(-(songPosition + offsetSeconds))}s
          </div>
        </>
      )}
    </div>
  );
}

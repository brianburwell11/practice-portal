import { useEffect, useRef, useState } from 'react';
import { YouTubeIframe, type YouTubeIframeHandle } from './YouTubeIframe';
import { useYouTubeSync } from '../../youtube/useYouTubeSync';
import { useTransportStore } from '../../store/transportStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';

interface Props {
  videoId: string;
  title?: string;
  offsetSeconds: number;
  defaultX: number;
  defaultY: number;
  zIndex: number;
  admin?: boolean;
  onBringToFront: () => void;
  onSaveOffset?: (offset: number) => Promise<void>;
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
  admin = false,
  onBringToFront,
  onSaveOffset,
}: Props) {
  const [pos, setPos] = useState({ x: defaultX, y: defaultY });
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [savingSync, setSavingSync] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const playerRef = useRef<YouTubeIframeHandle>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const songPosition = useTransportStore((s) => s.position);
  const engine = useAudioEngine();
  const inWaitWindow = !calibrating && offsetSeconds < 0 && songPosition + offsetSeconds < 0;

  // Toggling calibrate mode rebuilds the iframe (different playerVars),
  // so the existing player handle becomes stale until the new YT
  // instance fires onReady again.
  useEffect(() => {
    setReady(false);
  }, [calibrating]);

  useYouTubeSync(playerRef.current, ready, offsetSeconds, calibrating);

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

  const handleSetSync = async () => {
    if (!playerRef.current || !onSaveOffset) return;
    const ytTime = playerRef.current.getCurrentTime();
    const songTime = engine.clock.currentTime;
    const newOffset = ytTime - songTime;
    setSavingSync(true);
    setSyncError(null);
    try {
      await onSaveOffset(newOffset);
      setCalibrating(false);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingSync(false);
    }
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
        outline: calibrating ? '2px solid #f59e0b' : 'none',
        outlineOffset: -2,
      }}
      onPointerDown={onBringToFront}
    >
      <div
        style={{
          height: HEADER,
          background: calibrating ? '#78350f' : '#1f2937',
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
          {calibrating ? 'Calibrating — line up the anchor' : title || videoId}
        </span>
        {admin && onSaveOffset && (
          calibrating ? (
            <>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); handleSetSync(); }}
                disabled={savingSync || !ready}
                title="Capture current YT/song times as the new offset"
                style={{
                  background: '#16a34a',
                  border: 'none',
                  color: '#fff',
                  cursor: savingSync || !ready ? 'wait' : 'pointer',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: 3,
                  opacity: savingSync || !ready ? 0.6 : 1,
                }}
              >
                {savingSync ? 'Saving…' : 'Set Sync'}
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setCalibrating(false); }}
                title="Cancel calibration"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fbbf24',
                  cursor: 'pointer',
                  fontSize: 10,
                  padding: '2px 4px',
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setCalibrating(true); }}
              title="Calibrate sync — scrub YT to match the song's anchor"
              style={{
                background: 'transparent',
                border: '1px solid #4b5563',
                color: '#9ca3af',
                cursor: 'pointer',
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 3,
              }}
            >
              Sync
            </button>
          )
        )}
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
        interactive={calibrating}
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
      {syncError && (
        <div
          style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            right: 4,
            background: 'rgba(127, 29, 29, 0.9)',
            color: '#fecaca',
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 3,
            pointerEvents: 'none',
          }}
        >
          {syncError}
        </div>
      )}
    </div>
  );
}

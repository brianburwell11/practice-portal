import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { loadYouTubeApi } from '../../youtube/loadYouTubeApi';

export interface YouTubeIframeHandle {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  mute: () => void;
  unMute: () => void;
}

interface Props {
  videoId: string;
  width?: number;
  height?: number;
  muted?: boolean;
  /** When true the player is rebuilt with native YT controls, fullscreen,
   *  keyboard shortcuts, and pointer events enabled — used for the
   *  admin's tap-to-sync calibration. */
  interactive?: boolean;
  onReady?: () => void;
  onStateChange?: (state: number) => void;
  onError?: (code: number) => void;
}

export const YouTubeIframe = forwardRef<YouTubeIframeHandle, Props>(function YouTubeIframe(
  { videoId, width = 320, height = 180, muted = true, interactive = false, onReady, onStateChange, onError },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const readyRef = useRef(false);
  const initialMutedRef = useRef(muted);
  const onReadyRef = useRef(onReady);
  const onStateChangeRef = useRef(onStateChange);
  const onErrorRef = useRef(onError);
  onReadyRef.current = onReady;
  onStateChangeRef.current = onStateChange;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    let player: YT.Player | null = null;

    loadYouTubeApi().then((YTApi) => {
      if (cancelled || !containerRef.current) return;
      player = new YTApi.Player(containerRef.current, {
        videoId,
        width,
        height,
        playerVars: interactive
          ? {
              autoplay: 0,
              controls: 1,
              modestbranding: 1,
              playsinline: 1,
              rel: 0,
            }
          : {
              autoplay: 0,
              controls: 0,
              disablekb: 1,
              fs: 0,
              iv_load_policy: 3,
              modestbranding: 1,
              playsinline: 1,
              rel: 0,
            },
        events: {
          onReady: () => {
            readyRef.current = true;
            if (initialMutedRef.current) player?.mute();
            onReadyRef.current?.();
          },
          onStateChange: (e) => onStateChangeRef.current?.(e.data),
          onError: (e) => onErrorRef.current?.(e.data),
        },
      });
      playerRef.current = player;
    });

    return () => {
      cancelled = true;
      readyRef.current = false;
      try {
        playerRef.current?.destroy();
      } catch {
        // The iframe may already be detached; safe to ignore.
      }
      playerRef.current = null;
    };
  }, [videoId, width, height, interactive]);

  useImperativeHandle(
    ref,
    () => ({
      play: () => playerRef.current?.playVideo(),
      pause: () => playerRef.current?.pauseVideo(),
      seekTo: (s, allowSeekAhead = true) => playerRef.current?.seekTo(s, allowSeekAhead),
      setPlaybackRate: (r) => playerRef.current?.setPlaybackRate(r),
      getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
      getPlayerState: () => playerRef.current?.getPlayerState() ?? -1,
      mute: () => playerRef.current?.mute(),
      unMute: () => playerRef.current?.unMute(),
    }),
    [],
  );

  return (
    <div style={{ pointerEvents: interactive ? 'auto' : 'none' }}>
      <div ref={containerRef} />
    </div>
  );
});

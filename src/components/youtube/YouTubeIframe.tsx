import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { loadYouTubeApi } from '../../youtube/loadYouTubeApi';

export interface YouTubeIframeHandle {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime: () => number;
  mute: () => void;
  unMute: () => void;
}

interface Props {
  videoId: string;
  width?: number;
  height?: number;
  muted?: boolean;
  onReady?: () => void;
  onStateChange?: (state: number) => void;
  onError?: (code: number) => void;
}

export const YouTubeIframe = forwardRef<YouTubeIframeHandle, Props>(function YouTubeIframe(
  { videoId, width = 320, height = 180, muted = true, onReady, onStateChange, onError },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const readyRef = useRef(false);
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
        playerVars: {
          autoplay: 0,
          controls: 1,
          disablekb: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            if (muted) player?.mute();
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
  }, [videoId, width, height, muted]);

  useImperativeHandle(
    ref,
    () => ({
      play: () => playerRef.current?.playVideo(),
      pause: () => playerRef.current?.pauseVideo(),
      seekTo: (s, allowSeekAhead = true) => playerRef.current?.seekTo(s, allowSeekAhead),
      setPlaybackRate: (r) => playerRef.current?.setPlaybackRate(r),
      getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
      mute: () => playerRef.current?.mute(),
      unMute: () => playerRef.current?.unMute(),
    }),
    [],
  );

  return <div ref={containerRef} />;
});

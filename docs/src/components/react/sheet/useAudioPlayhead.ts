import { useEffect, useRef, useState } from 'react';

/**
 * Drive a `currentTime` value from a real `<audio>` element via
 * `requestAnimationFrame`. Returns the live position (in seconds), the
 * element ref to attach, the duration, and play/pause/seek helpers.
 *
 * Rationale: in production, the practice-portal exposes `useAudioEngine()`
 * and `transportStore.position`. For docs widgets we don't want to wire
 * through the full engine, so we just read `audio.currentTime` directly.
 * The math from `position → beat → cursor index` is identical either way.
 */
export interface AudioPlayhead {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
  duration: number;
  playing: boolean;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => Promise<void>;
  seek: (seconds: number) => void;
}

export function useAudioPlayhead(src: string): AudioPlayhead {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onMeta = () => setDuration(a.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    return () => {
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
    };
  }, [src]);

  // RAF loop while playing — read currentTime at frame rate so the cursor
  // animation is smooth instead of bound to the audio element's `timeupdate`
  // (which only fires every ~250ms on most browsers).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a) setCurrentTime(a.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Pull initial currentTime when the element mounts (covers strict-mode reset)
  useEffect(() => {
    const a = audioRef.current;
    if (a) setCurrentTime(a.currentTime);
  }, []);

  const play = async () => {
    const a = audioRef.current;
    if (!a) return;
    await a.play();
  };
  const pause = () => audioRef.current?.pause();
  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) await a.play();
    else a.pause();
  };
  const seek = (s: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(s, a.duration || s));
    setCurrentTime(a.currentTime);
  };

  return { audioRef, currentTime, duration, playing, play, pause, toggle, seek };
}

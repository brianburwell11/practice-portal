import { useEffect, useRef } from 'react';
import { useTransportStore } from '../store/transportStore';
import { useAudioEngine } from '../hooks/useAudioEngine';
import type { YouTubeIframeHandle } from '../components/youtube/YouTubeIframe';

const MIN_RATE = 0.25;
const MAX_RATE = 2;
/** YT.PlayerState values — typed inline to avoid pulling the YT
 *  namespace into a non-iframe-owning module. */
const YT_PLAYING = 1;
const YT_BUFFERING = 3;
/** Position deltas larger than this (forward jump) or any backward
 *  jump are treated as user-initiated seeks. Smaller deltas are normal
 *  RAF-driven progression and would cause constant rebuffering if we
 *  re-seeked YT on each one. */
const SEEK_FORWARD_THRESHOLD = 0.5;
const SEEK_BACKWARD_THRESHOLD = 0.1;
const DRIFT_THRESHOLD = 0.4;
const DRIFT_INTERVAL_MS = 1000;

const clampRate = (r: number) => Math.min(MAX_RATE, Math.max(MIN_RATE, r));

/** Slaves a YouTube IFrame player to the song clock. The store's
 *  `position` updates every animation frame during playback, so we
 *  only re-seek YT on detected seeks (large jumps, including loop
 *  wraps); a 1Hz drift check catches smaller misalignments and
 *  handles the negative-offset wait period. */
export function useYouTubeSync(
  player: YouTubeIframeHandle | null,
  ready: boolean,
  offsetSeconds: number,
  disabled = false,
) {
  const engine = useAudioEngine();
  const playing = useTransportStore((s) => s.playing);
  const position = useTransportStore((s) => s.position);
  const tempoRatio = useTransportStore((s) => s.tempoRatio);

  const lastPosRef = useRef(position);

  // Initial sync — land at the right offset whenever the player
  // becomes ready or the offset changes. Negative targets are clamped
  // to 0 (YT can't seek before the start of the video); the player
  // stays paused there until the song catches up.
  useEffect(() => {
    if (!ready || !player || disabled) return;
    const t = engine.clock.currentTime;
    const target = t + offsetSeconds;
    player.seekTo(Math.max(0, target), true);
    lastPosRef.current = t;
  }, [ready, player, offsetSeconds, engine, disabled]);

  // Seek detection — react only to non-natural position jumps.
  useEffect(() => {
    if (!ready || !player || disabled) return;
    const last = lastPosRef.current;
    const delta = position - last;
    lastPosRef.current = position;
    if (delta > -SEEK_BACKWARD_THRESHOLD && delta < SEEK_FORWARD_THRESHOLD) return;

    const target = position + offsetSeconds;
    if (target < 0) {
      // Scrubbed into the wait window — park at 0 and pause.
      player.pause();
      player.seekTo(0, true);
    } else {
      player.seekTo(target, true);
      if (playing) player.play();
    }
  }, [position, ready, player, offsetSeconds, playing, disabled]);

  // Play/pause. While in the wait window (target < 0), keep YT paused
  // even when the song is playing — the 1Hz monitor below will start
  // YT once the song crosses into the playable range.
  useEffect(() => {
    if (!ready || !player || disabled) return;
    const target = engine.clock.currentTime + offsetSeconds;
    if (playing && target >= 0) player.play();
    else player.pause();
  }, [playing, ready, player, offsetSeconds, engine, disabled]);

  // Match playback rate to song tempo.
  useEffect(() => {
    if (!ready || !player || disabled) return;
    player.setPlaybackRate(clampRate(tempoRatio));
  }, [tempoRatio, ready, player, disabled]);

  // 1Hz monitor: drift correction during normal play, plus the
  // negative→positive transition for offset videos.
  useEffect(() => {
    if (!ready || !player || !playing || disabled) return;
    const interval = setInterval(() => {
      if (player.getPlayerState() === YT_BUFFERING) return;
      const target = engine.clock.currentTime + offsetSeconds;
      const state = player.getPlayerState();

      if (target < 0) {
        // Wait window — keep YT paused at 0 so it shows a static
        // start-frame instead of looping.
        if (state === YT_PLAYING) {
          player.pause();
          player.seekTo(0, true);
        }
        return;
      }

      if (state !== YT_PLAYING) {
        // Crossed from the wait window, or YT got paused for some
        // other reason — kick it off at the current target.
        player.seekTo(target, true);
        player.play();
        return;
      }

      const ytTime = player.getCurrentTime();
      if (Math.abs(ytTime - target) > DRIFT_THRESHOLD) {
        player.seekTo(target, true);
      }
    }, DRIFT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [playing, ready, player, offsetSeconds, engine, disabled]);
}

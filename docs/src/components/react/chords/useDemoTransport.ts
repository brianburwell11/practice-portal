import { useCallback, useEffect, useRef, useState } from 'react';
import { BEATS, BEATS_PER_BAR, SONG_END, type TimedChord } from './demoSong';
import { chordMidi, parseChord } from './theory';

/** One shared AudioContext for every widget on the page. */
let ctx: AudioContext | null = null;
function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function playChordSound(symbol: string, volume = 0.16): void {
  const c = parseChord(symbol);
  if (!c) return;
  const ac = audio();
  const now = ac.currentTime;
  chordMidi(c).forEach((m, i) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = i === 0 ? 'sine' : 'triangle';
    osc.frequency.value = midiHz(m);
    const peak = i === 0 ? volume * 1.4 : volume;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    osc.connect(g).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 1.9);
  });
}

function playClick(accent: boolean): void {
  const ac = audio();
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.frequency.value = accent ? 1600 : 1100;
  g.gain.setValueAtTime(accent ? 0.12 : 0.06, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
  osc.connect(g).connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

export interface DemoTransport {
  position: number;
  playing: boolean;
  speed: number;
  setSpeed: (s: number) => void;
  sound: boolean;
  setSound: (b: boolean) => void;
  click: boolean;
  setClick: (b: boolean) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  /** Exact clock, for stamping on a keypress (not the last rendered tick). */
  now: () => number;
  duration: number;
}

/**
 * A fake transport: a clock that runs at `speed`, plays a soft click on each
 * tapMap beat and a synth chord on each chord change. Stands in for the app's
 * AudioEngine so the widgets need no audio files.
 */
export function useDemoTransport(chords: TimedChord[], beats: number[] = BEATS): DemoTransport {
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [sound, setSound] = useState(true);
  const [click, setClick] = useState(true);

  const pos = useRef(0);
  const last = useRef(0);
  const live = useRef({ chords, beats, speed, sound, click });
  live.current = { chords, beats, speed, sound, click };

  const sync = useCallback(() => {
    if (playing) {
      const t = performance.now();
      pos.current = Math.min(SONG_END, pos.current + ((t - last.current) / 1000) * live.current.speed);
      last.current = t;
    }
    return pos.current;
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    last.current = performance.now();
    const tick = () => {
      const prev = pos.current;
      const cur = sync();
      const L = live.current;
      if (L.click) {
        L.beats.forEach((b, i) => {
          if (b > prev && b <= cur) playClick(i % BEATS_PER_BAR === 0);
        });
      }
      if (L.sound) {
        for (const c of L.chords) if (c.time > prev && c.time <= cur) playChordSound(c.symbol);
      }
      setPosition(cur);
      if (cur >= SONG_END) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, sync]);

  const play = useCallback(() => {
    if (pos.current >= SONG_END - 0.05) pos.current = 0;
    audio();
    // Sound the chord already ringing where we start.
    const L = live.current;
    const current = [...L.chords].reverse().find((c) => c.time <= pos.current);
    if (L.sound && current && pos.current > current.time + 0.05) playChordSound(current.symbol, 0.1);
    setPlaying(true);
  }, []);
  const pause = useCallback(() => {
    sync();
    setPlaying(false);
    setPosition(pos.current);
  }, [sync]);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, play, pause]);
  const seek = useCallback((t: number) => {
    pos.current = Math.max(0, Math.min(SONG_END, t));
    last.current = performance.now();
    setPosition(pos.current);
  }, []);

  return {
    position, playing, speed, setSpeed, sound, setSound, click, setClick,
    toggle, play, pause, seek, now: sync, duration: SONG_END,
  };
}

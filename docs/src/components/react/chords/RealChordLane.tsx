import { useEffect, useMemo } from 'react';
import { ChordLane } from '@app/components/chords/ChordLane';
import { LyricsDisplay } from '@app/components/LyricsDisplay';
import { AudioEngineContext } from '@app/hooks/useAudioEngine';
import { useChordsStore } from '@app/store/chordsStore';
import { useLyricsStore } from '@app/store/lyricsStore';
import { useSongStore } from '@app/store/songStore';
import { useTransportStore } from '@app/store/transportStore';
import type { AudioEngine } from '@app/audio/AudioEngine';
import type { SongConfig, TapMapEntry } from '@app/audio/types';
import { BEATS, BEATS_PER_BAR, LYRICS, SONG_END, TIMED } from './demoSong';
import { useDemoTransport } from './useDemoTransport';
import { TransportBar, panel } from './ui';

/** The demo song's beat times as a tapMap: a measure tap every bar, beat taps between. */
const TAP_MAP: TapMapEntry[] = BEATS.map((time, i) => ({
  time,
  type: i === 0 ? 'section' : i % BEATS_PER_BAR === 0 ? 'measure' : 'beat',
  ...(i === 0 ? { label: 'A' } : {}),
}));

/**
 * The app's real `ChordLane` and `LyricsDisplay`, fed by the demo song and
 * the demo transport instead of the AudioEngine. The waveform here is a stand-in
 * marked `data-waveform-timeline`, which is what both components measure the
 * reading point from. Desktop widths show the lyrics-aligned lane; phone
 * widths show the slot lane (lyrics hide on phones until toggled).
 */
export function RealChordLane() {
  const t = useDemoTransport(TIMED);

  useEffect(() => {
    useChordsStore.getState().setChords(TIMED.map(({ symbol, time }) => ({ symbol, time })));
    useLyricsStore.getState().setLyrics(LYRICS.map(({ text, time }) => ({ text, time })));
    useSongStore.getState().setSelectedSong({
      tapMap: TAP_MAP,
      timeSignatureMap: [{ beat: 0, numerator: 4, denominator: 4 }],
    } as unknown as SongConfig);
  }, []);

  useEffect(() => {
    useTransportStore.getState().setPosition(t.position);
  }, [t.position]);

  // Only `seek` is used by the lane and lyrics; route it to the demo transport.
  const demoSeek = t.seek;
  const engine = useMemo(() => ({ seek: (s: number) => demoSeek(s) }) as unknown as AudioEngine, [demoSeek]);

  return (
    <div style={{ ...panel, background: '#0b0f17' }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>The real ChordLane</div>
      <div style={{ color: 'var(--text-secondary, #808080)', fontSize: 12.5, marginBottom: 10 }}>
        The component from <code>src/components/chords/ChordLane.tsx</code> with the real lyric track under it. Click a chord to
        jump there; the <code>5s</code> button cycles the look-ahead.
      </div>
      <AudioEngineContext.Provider value={engine}>
        <div className="flex items-center gap-2 py-2">
          <div className="hidden md:flex items-center gap-1.5" style={{ width: 220 }}>
            {['▶', '⟲', 'Vol', 'Speed'].map((l) => (
              <span key={l} className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-500">{l}</span>
            ))}
          </div>
          <div data-waveform-timeline className="relative flex-1 h-[60px] rounded bg-gray-800/60 overflow-hidden">
            <span
              className="absolute inset-y-0 w-0.5 bg-gray-200"
              style={{ left: `${(t.position / SONG_END) * 100}%` }}
            />
          </div>
        </div>
        <ChordLane />
        <LyricsDisplay />
      </AudioEngineContext.Provider>
      <TransportBar t={t} />
    </div>
  );
}

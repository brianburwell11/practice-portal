import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChordLane } from './ChordLane';
import { AudioEngineContext } from '../../hooks/useAudioEngine';
import { useChordsStore } from '../../store/chordsStore';
import { usePanelMinimizeStore } from '../../store/panelMinimizeStore';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { SongConfig } from '../../audio/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WAVEFORM_LEFT = 220;
const READING_X = WAVEFORM_LEFT + 24;
const HIT = READING_X - 7;

let host: HTMLDivElement;
let waveform: HTMLDivElement;
let root: Root;
const seek = vi.fn();

beforeAll(() => {
  // happy-dom doesn't lay out; give every element a width and the waveform its left edge.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1000 });
  const rect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.hasAttribute('data-waveform-timeline')) return { left: WAVEFORM_LEFT } as DOMRect;
    if (this.isConnected) return { left: 0 } as DOMRect;
    return rect.call(this);
  };
});

beforeEach(() => {
  waveform = document.createElement('div');
  waveform.setAttribute('data-waveform-timeline', '');
  document.body.appendChild(waveform);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  seek.mockReset();
  useChordsStore.getState().clear();
  useChordsStore.getState().setLookAhead(10);
  useChordsStore.setState({ mobileVisible: true });
  usePanelMinimizeStore.getState().clearAll();
  useSongStore.getState().setSelectedSong({ tapMap: [], timeSignatureMap: [] } as unknown as SongConfig);
  useTransportStore.getState().setPosition(0);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  waveform.remove();
});

function render() {
  const engine = { seek } as unknown as AudioEngine;
  act(() => root.render(createElement(AudioEngineContext.Provider, { value: engine }, createElement(ChordLane))));
}

const desktop = () => host.querySelector('.md\\:block') as HTMLElement | null;
const phone = () => host.querySelector('.md\\:hidden') as HTMLElement | null;
const labels = (el: HTMLElement | null) => [...(el?.querySelectorAll('button[title^="Play from"]') ?? [])] as HTMLElement[];
const shiftOf = (el: HTMLElement) => Number(/translateX\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1]);

describe('ChordLane', () => {
  it('renders nothing when the song has no chords', () => {
    useChordsStore.getState().setChords([]);
    render();
    expect(host.innerHTML).toBe('');
  });

  it('shows the current chord and only the upcoming chords within the look-ahead', () => {
    useChordsStore.getState().setChords([
      { symbol: 'G', time: 1 },
      { symbol: 'Em7', time: 4 },
      { symbol: 'C', time: 20 },
    ]);
    act(() => useTransportStore.getState().setPosition(2));
    render();
    expect(labels(desktop()).map((b) => b.textContent)).toEqual(['Em7', 'G']); // upcoming, then current
    expect(phone()?.textContent).toContain('G');
  });

  it('starts the current chord on the lyric reading point (desktop)', () => {
    useChordsStore.getState().setChords([
      { symbol: 'G', time: 1 },
      { symbol: 'D', time: 30 },
    ]);
    act(() => useTransportStore.getState().setPosition(2));
    render();
    const current = labels(desktop()).find((b) => b.textContent === 'G')!;
    expect(shiftOf(current)).toBe(HIT);
  });

  it('lets the next chord push the current one off to the left', () => {
    useChordsStore.getState().setChords([
      { symbol: 'G', time: 1 },
      { symbol: 'D', time: 2.05 },
    ]);
    act(() => useTransportStore.getState().setPosition(2));
    render();
    const current = labels(desktop()).find((b) => b.textContent === 'G')!;
    const next = labels(desktop()).find((b) => b.textContent === 'D')!;
    expect(shiftOf(current)).toBeLessThan(HIT);
    expect(shiftOf(next)).toBeGreaterThan(HIT);
    expect(shiftOf(next) - shiftOf(current)).toBeGreaterThan(0);
  });

  it('puts a chord exactly on the reading point when it sounds', () => {
    useChordsStore.getState().setChords([
      { symbol: 'G', time: 1 },
      { symbol: 'D', time: 3 },
    ]);
    act(() => useTransportStore.getState().setPosition(3));
    render();
    const d = labels(desktop()).find((b) => b.textContent === 'D')!;
    expect(shiftOf(d)).toBe(HIT);
  });

  it('shows real flat and sharp signs', () => {
    useChordsStore.getState().setChords([
      { symbol: 'Bb', time: 1 },
      { symbol: 'F#m7b5', time: 3 },
    ]);
    act(() => useTransportStore.getState().setPosition(2));
    render();
    expect(labels(desktop()).map((b) => b.textContent).sort()).toEqual(['B♭', 'F♯m7♭5']);
    expect(useChordsStore.getState().chords.map((c) => c.symbol)).toEqual(['Bb', 'F#m7b5']); // stored as typed
  });

  it('seeks to a chord when it is clicked', () => {
    useChordsStore.getState().setChords([
      { symbol: 'G', time: 1 },
      { symbol: 'C', time: 3.5 },
    ]);
    act(() => useTransportStore.getState().setPosition(2));
    render();
    act(() => labels(desktop()).find((b) => b.textContent === 'C')!.click());
    expect(seek).toHaveBeenCalledWith(3.5);
  });

  it('hides the phone lane until its button turns it on', () => {
    useChordsStore.setState({ mobileVisible: false });
    useChordsStore.getState().setChords([{ symbol: 'G', time: 0 }]);
    render();
    expect(phone()).toBeNull();
    expect(desktop()).not.toBeNull();
    act(() => useChordsStore.getState().toggleMobileVisible());
    expect(phone()).not.toBeNull();
  });

  it('always shows the phone lane under the chords editor', () => {
    useChordsStore.setState({ mobileVisible: false });
    const engine = { seek } as unknown as AudioEngine;
    act(() =>
      root.render(
        createElement(
          AudioEngineContext.Provider,
          { value: engine },
          createElement(ChordLane, { overrideChords: [{ symbol: 'G', time: 0 }] }),
        ),
      ),
    );
    expect(phone()).not.toBeNull();
  });

  it('hides the desktop lane when minimized, keeping the phone lane', () => {
    useChordsStore.getState().setChords([{ symbol: 'G', time: 0 }]);
    render();
    act(() => (host.querySelector('[aria-label="Minimize chords"]') as HTMLElement).click());
    expect(desktop()).toBeNull();
    expect(phone()).not.toBeNull();
  });

  it('cycles the look-ahead and remembers it', () => {
    useChordsStore.getState().setChords([{ symbol: 'G', time: 0 }]);
    render();
    act(() => (host.querySelector('[aria-label="Show chords 10 seconds ahead"]') as HTMLElement).click());
    expect(useChordsStore.getState().lookAhead).toBe(15);
    expect(window.localStorage.getItem('practice-portal.chordLookAhead')).toBe('15');
  });
});

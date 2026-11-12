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
  useTransportStore.setState({ playing: false });
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
/** A wheel event; happy-dom drops `shiftKey` from the init, so it's set here. */
const wheel = (deltaY: number, shiftKey: boolean) => {
  const e = new WheelEvent('wheel', { deltaY, cancelable: true });
  Object.defineProperty(e, 'shiftKey', { value: shiftKey });
  return e;
};
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

  it('shows section names: the current one pinned, later ones scrolling in', () => {
    useSongStore.getState().setSelectedSong({
      tapMap: [
        { time: 0, type: 'section', label: 'Intro' },
        { time: 1, type: 'measure' },
        { time: 6, type: 'section', label: 'Verse' },
        { time: 60, type: 'section', label: 'Chorus' },
      ],
      timeSignatureMap: [],
    } as unknown as SongConfig);
    useChordsStore.getState().setChords([{ symbol: 'G', time: 0 }]);
    act(() => useTransportStore.getState().setPosition(2));
    render();
    const section = (el: HTMLElement | null, name: string) =>
      labels(el).find((b) => b.textContent === name);
    // Desktop: Intro sits at the reading point, Verse is on its way, Chorus is too far ahead.
    expect(shiftOf(section(desktop(), 'Intro')!)).toBe(HIT);
    expect(shiftOf(section(desktop(), 'Verse')!)).toBeGreaterThan(HIT);
    expect(section(desktop(), 'Chorus')).toBeUndefined();
    // Phone: the current section is in the slot.
    expect(section(phone(), 'Intro')).toBeDefined();
    act(() => section(desktop(), 'Verse')!.click());
    expect(seek).toHaveBeenCalledWith(6);
  });

  it('draws bar lines on the measure taps, not on the chords (a pushed chord sits before the bar)', () => {
    useSongStore.getState().setSelectedSong({
      tapMap: [
        { time: 0, type: 'measure' },
        { time: 4, type: 'measure' },
        { time: 8, type: 'measure' },
      ],
      timeSignatureMap: [],
    } as unknown as SongConfig);
    // C is pushed an eighth ahead of the bar at 4.
    useChordsStore.getState().setChords([{ symbol: 'G', time: 0 }, { symbol: 'C', time: 3.75 }]);
    act(() => useTransportStore.getState().setPosition(0));
    render();
    const lane = desktop()!;
    const bars = [...lane.querySelectorAll('div.top-0.w-0\\.5')].map((el) => shiftOf(el as HTMLElement));
    const chordC = labels(lane).find((b) => b.textContent === 'C')!;
    const pps = (1000 - HIT) / 10;
    expect(bars).toContain(HIT + 4 * pps);
    expect(bars).not.toContain(shiftOf(chordC));
    expect(shiftOf(chordC)).toBeCloseTo(HIT + 3.75 * pps);
  });

  it('shift + scroll moves the lane by hand until playback catches up', () => {
    useChordsStore.getState().setChords([{ symbol: 'G', time: 0 }, { symbol: 'C', time: 8 }]);
    act(() => useTransportStore.setState({ position: 1, playing: true }));
    render();
    const pps = (1000 - HIT) / 10;
    const chordC = () => labels(desktop()).find((b) => b.textContent === 'C')!;
    const lane = desktop()!.querySelector('.overflow-hidden') as HTMLElement;
    expect(shiftOf(chordC())).toBeCloseTo(HIT + 7 * pps);

    // A plain scroll leaves it alone; with Shift it moves the lane 2 s on.
    act(() => { lane.dispatchEvent(wheel(2 * pps, false)); });
    expect(shiftOf(chordC())).toBeCloseTo(HIT + 7 * pps);
    act(() => { lane.dispatchEvent(wheel(2 * pps, true)); });
    expect(shiftOf(chordC())).toBeCloseTo(HIT + 5 * pps);

    // Holds while playback is short of that point, follows again once it gets there.
    act(() => useTransportStore.setState({ position: 2 }));
    expect(shiftOf(chordC())).toBeCloseTo(HIT + 5 * pps);
    act(() => useTransportStore.setState({ position: 3.1 }));
    expect(shiftOf(chordC())).toBeCloseTo(HIT + 4.9 * pps);
  });

  it('shift + scroll lets go when playback pauses', () => {
    useChordsStore.getState().setChords([{ symbol: 'G', time: 0 }, { symbol: 'C', time: 8 }]);
    act(() => useTransportStore.setState({ position: 1, playing: true }));
    render();
    const pps = (1000 - HIT) / 10;
    const lane = desktop()!.querySelector('.overflow-hidden') as HTMLElement;
    act(() => { lane.dispatchEvent(wheel(3 * pps, true)); });
    act(() => useTransportStore.setState({ playing: false }));
    const chordC = labels(desktop()).find((b) => b.textContent === 'C')!;
    expect(shiftOf(chordC)).toBeCloseTo(HIT + 7 * pps);
    act(() => useTransportStore.setState({ playing: false, position: 0 }));
  });

  it('cycles the look-ahead and remembers it', () => {
    useChordsStore.getState().setChords([{ symbol: 'G', time: 0 }]);
    render();
    act(() => (host.querySelector('[aria-label="Show chords 10 seconds ahead"]') as HTMLElement).click());
    expect(useChordsStore.getState().lookAhead).toBe(15);
    expect(window.localStorage.getItem('practice-portal.chordLookAhead')).toBe('15');
  });

  it('cmd + scroll and pinch zoom the look-ahead about the reading point', () => {
    useChordsStore.getState().setChords([{ symbol: 'G', time: 0 }, { symbol: 'C', time: 4 }]);
    act(() => useTransportStore.setState({ position: 1 }));
    render();
    const lane = desktop()!.querySelector('.overflow-hidden') as HTMLElement;
    const chordC = () => labels(desktop()).find((b) => b.textContent === 'C')!;
    const zoomWheel = (deltaY: number, key: 'metaKey' | 'ctrlKey') => {
      const e = new WheelEvent('wheel', { deltaY, cancelable: true });
      Object.defineProperty(e, key, { value: true });
      return e;
    };

    // Cmd + scroll down zooms out, capped per notch like the waveform.
    let e = zoomWheel(100, 'metaKey');
    act(() => { lane.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true);
    expect(useChordsStore.getState().lookAhead).toBeCloseTo(11.5);
    // The reading point holds: C, 3 s out, sits at 3 s of the new scale.
    expect(shiftOf(chordC())).toBeCloseTo(HIT + 3 * ((1000 - HIT) / 11.5));

    // A pinch (ctrlKey, small deltas) zooms in proportionally.
    e = zoomWheel(-10, 'ctrlKey');
    act(() => { lane.dispatchEvent(e); });
    expect(useChordsStore.getState().lookAhead).toBeCloseTo(11.5 * Math.exp(-0.1));

    // Clamped at both ends.
    act(() => { for (let i = 0; i < 40; i++) lane.dispatchEvent(zoomWheel(-100, 'metaKey')); });
    expect(useChordsStore.getState().lookAhead).toBe(4);
    act(() => { for (let i = 0; i < 40; i++) lane.dispatchEvent(zoomWheel(100, 'metaKey')); });
    expect(useChordsStore.getState().lookAhead).toBe(60);
  });

  it('the look-ahead button steps up from a zoomed value and shows it rounded', () => {
    useChordsStore.getState().setChords([{ symbol: 'G', time: 0 }]);
    useChordsStore.getState().setLookAhead(12.4);
    render();
    const button = host.querySelector('[aria-label="Show chords 12 seconds ahead"]') as HTMLElement;
    expect(button.textContent).toBe('12s');
    act(() => button.click());
    expect(useChordsStore.getState().lookAhead).toBe(15);
    act(() => useChordsStore.getState().setLookAhead(45));
    act(() => (host.querySelector('[aria-label="Show chords 45 seconds ahead"]') as HTMLElement).click());
    expect(useChordsStore.getState().lookAhead).toBe(10);
  });

  it('a two-finger pinch on the phone lane zooms and shows the look-ahead', () => {
    useChordsStore.getState().setChords([{ symbol: 'G', time: 0 }, { symbol: 'C', time: 4 }]);
    render();
    const lane = phone()!;
    /** A touch event with fingers at these x positions; happy-dom drops `touches` from the init. */
    const touch = (type: string, xs: number[]) => {
      const e = new Event(type, { cancelable: true });
      Object.defineProperty(e, 'touches', { value: xs.map((clientX) => ({ clientX, clientY: 0 })) });
      return e;
    };

    // One finger does nothing, so it can still scroll the page.
    let e = touch('touchmove', [100]);
    act(() => { lane.dispatchEvent(touch('touchstart', [100])); lane.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(false);
    expect(lane.querySelector('[data-pinch-readout]')).toBeNull();

    // Fingers 100 px apart, then 200: zoomed in to half the seconds.
    act(() => { lane.dispatchEvent(touch('touchstart', [100, 200])); });
    e = touch('touchmove', [50, 250]);
    act(() => { lane.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true);
    expect(useChordsStore.getState().lookAhead).toBe(5);
    expect(lane.querySelector('[data-pinch-readout]')?.textContent).toBe('5s ahead');

    // Pinched together past the limit: clamped. Lifting a finger ends it.
    act(() => { lane.dispatchEvent(touch('touchmove', [149, 151])); });
    expect(useChordsStore.getState().lookAhead).toBe(60);
    act(() => { lane.dispatchEvent(touch('touchend', [150])); });
    expect(lane.querySelector('[data-pinch-readout]')).toBeNull();
  });

  it('chords too close to the last named one show as ticks', () => {
    // At 60 s across ~760 px, chords 0.25 s apart are ~3 px apart.
    useChordsStore.getState().setLookAhead(60);
    useChordsStore.getState().setChords([
      { symbol: 'G', time: 0 },
      { symbol: 'Am', time: 2 },
      { symbol: 'Bm', time: 2.25 },
      { symbol: 'C', time: 2.5 },
      { symbol: 'D', time: 20 },
    ]);
    render();
    const named = labels(desktop()).map((b) => b.textContent);
    expect(named).toEqual(expect.arrayContaining(['G', 'Am', 'D']));
    expect(named).not.toContain('Bm');
    expect(named).not.toContain('C');
    const ticks = [...desktop()!.querySelectorAll('[data-chord-tick]')].map((t) => t.getAttribute('title'));
    expect(ticks).toEqual(['Bm', 'C']);

    // Zoomed in, there's room for all of them.
    act(() => useChordsStore.getState().setLookAhead(4));
    expect(desktop()!.querySelectorAll('[data-chord-tick]')).toHaveLength(0);
    expect(labels(desktop()).map((b) => b.textContent)).toEqual(expect.arrayContaining(['Am', 'Bm', 'C']));
  });
});

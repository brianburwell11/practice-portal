import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChordsGridPane } from './ChordsGridPane';
import { ChordsStampPane } from './ChordsStampPane';
import { AudioEngineContext } from '../../hooks/useAudioEngine';
import { useChordsEditorStore } from '../../store/chordsEditorStore';
import { useSongStore } from '../../store/songStore';
import { useTransportStore } from '../../store/transportStore';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { SongConfig, TapMapEntry } from '../../audio/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Bars at 10, 14 and 18 seconds in 4/4: beats every second, 10 to 18.
const TAP_MAP: TapMapEntry[] = [
  { time: 10, type: 'section', label: 'A' },
  { time: 14, type: 'measure' },
  { time: 18, type: 'measure' },
];

let host: HTMLDivElement;
let root: Root;
const engine = { seek: vi.fn(), play: vi.fn(), pause: vi.fn(), clock: { currentTime: 0 } };

function setSong(tapMap: TapMapEntry[]) {
  useSongStore.getState().setSelectedSong({
    tapMap,
    timeSignatureMap: [{ beat: 0, numerator: 4, denominator: 4 }],
  } as unknown as SongConfig);
}

function render(pane: typeof ChordsGridPane) {
  act(() =>
    root.render(createElement(AudioEngineContext.Provider, { value: engine as unknown as AudioEngine }, createElement(pane))),
  );
}

const store = () => useChordsEditorStore.getState();
const chords = () => store().chords.map((c) => `${c.symbol}@${c.time}`);
const cellInput = () => host.querySelector('input[aria-label^="Chord at"]') as HTMLInputElement;

function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(target: EventTarget, key: string, opts: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  Object.values(engine).forEach((f) => typeof f === 'function' && (f as ReturnType<typeof vi.fn>).mockReset());
  useTransportStore.getState().setPosition(0);
  setSong(TAP_MAP);
  store().open([]);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  store().close();
});

describe('Grid mode', () => {
  it('types a chord, cleans up its spelling, and moves to the next beat on Space', () => {
    render(ChordsGridPane);
    type(cellInput(), 'am7');
    press(cellInput(), ' ');
    expect(chords()).toEqual(['Am7@10']);
    expect(cellInput().getAttribute('aria-label')).toBe('Chord at bar 1, beat 2');
    expect(host.textContent).toContain('saved as Am7');
  });

  it('Tab commits and jumps to the next bar; Shift+Tab goes back', () => {
    render(ChordsGridPane);
    type(cellInput(), 'G');
    press(cellInput(), 'Tab');
    type(cellInput(), 'd/f#');
    press(cellInput(), 'Tab');
    expect(chords()).toEqual(['G@10', 'D/F#@14']);
    expect(cellInput().getAttribute('aria-label')).toBe('Chord at bar 3, beat 1');
    press(cellInput(), 'Tab', { shiftKey: true });
    expect(cellInput().getAttribute('aria-label')).toBe('Chord at bar 2, beat 1');
  });

  it('refuses a name it does not know and stays put', () => {
    render(ChordsGridPane);
    type(cellInput(), 'Xq');
    press(cellInput(), ' ');
    expect(chords()).toEqual([]);
    expect(cellInput().getAttribute('aria-label')).toBe('Chord at bar 1, beat 1');
    expect(host.textContent).toContain(`"Xq" isn't a chord name I know`);
  });

  it('< pushes a chord to the "and" before its beat, and back', () => {
    render(ChordsGridPane);
    press(cellInput(), 'Tab'); // to bar 2, beat 1 (14s)
    type(cellInput(), 'C');
    press(cellInput(), '<');
    expect(chords()).toEqual(['C@13.5']);
    press(cellInput(), '<');
    expect(chords()).toEqual(['C@14']);
  });

  it('/ repeats the previous chord and % copies the previous bar', () => {
    render(ChordsGridPane);
    type(cellInput(), 'G');
    press(cellInput(), ' ');
    press(cellInput(), ' ');
    type(cellInput(), 'Em');
    press(cellInput(), ' ');
    press(cellInput(), '/'); // beat 4 repeats Em
    expect(chords()).toEqual(['G@10', 'Em@12', 'Em@13']);
    press(cellInput(), '%'); // cursor is now bar 2, beat 1: copy bar 1 into it
    expect(chords()).toEqual(['G@10', 'Em@12', 'Em@13', 'G@14', 'Em@16', 'Em@17']);
  });

  it('Backspace on an empty cell deletes its chord; Cmd+Z brings it back', () => {
    store().open([{ symbol: 'G', time: 10 }]);
    render(ChordsGridPane);
    press(cellInput(), 'Backspace');
    expect(chords()).toEqual([]);
    press(cellInput(), 'z', { metaKey: true });
    expect(chords()).toEqual(['G@10']);
  });

  it('labels the bar where each section starts', () => {
    useSongStore.getState().setSelectedSong({
      tapMap: [
        { time: 10, type: 'section', label: 'Verse' },
        { time: 14, type: 'measure' },
        { time: 18, type: 'section', label: 'Chorus' },
      ],
      timeSignatureMap: [{ beat: 0, numerator: 4, denominator: 4 }],
    } as unknown as SongConfig);
    render(ChordsGridPane);
    const labels = [...host.querySelectorAll('.text-amber-500')].map((el) => el.textContent);
    expect(labels).toEqual(['Verse', 'Chorus']);
  });

  it('lists free-time chords apart from the grid', () => {
    store().open([{ symbol: 'Cmaj7', time: 2 }, { symbol: 'G', time: 10 }]);
    render(ChordsGridPane);
    expect(host.textContent).toContain('Free time:');
    expect(host.textContent).toContain('Cmaj7');
  });

  it('points to Stamp when the song has no tapMap', () => {
    setSong([]);
    render(ChordsGridPane);
    expect(host.textContent).toContain('no tapMap');
    expect(cellInput()).toBeNull();
  });
});

const cell = (i: number) => host.querySelector(`[data-cell="${i}"]`) as HTMLElement;
function pointerDown(el: HTMLElement, opts: MouseEventInit = {}) {
  act(() => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, ...opts }));
  });
}

describe('Grid selection, copy and paste', () => {
  beforeEach(() =>
    store().open([
      { symbol: 'G', time: 10 },
      { symbol: 'Em', time: 12 },
      { symbol: 'C', time: 13.5 }, // pushed onto bar 2, beat 1
      { symbol: 'D', time: 16 },
    ]),
  );

  it('Shift+click selects a range without moving the playhead; Delete clears it, Cmd+Z restores', () => {
    render(ChordsGridPane);
    pointerDown(cell(3), { shiftKey: true });
    expect(engine.seek).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Bar 1 selected (4 beats)');
    press(cellInput(), 'Delete');
    expect(chords()).toEqual(['C@13.5', 'D@16']);
    press(cellInput(), 'z', { metaKey: true });
    expect(chords()).toEqual(['G@10', 'Em@12', 'C@13.5', 'D@16']);
  });

  it('copies a bar and pastes it over another, beat for beat, pushes included', () => {
    render(ChordsGridPane);
    pointerDown(cell(4));
    pointerDown(cell(7), { shiftKey: true });
    press(cellInput(), 'c', { metaKey: true });
    pointerDown(cell(0));
    press(cellInput(), 'v', { metaKey: true });
    // Bar 1 is now bar 2's contents: C pushed onto beat 1 (the "and" before 10), D on beat 3.
    expect(chords()).toEqual(['C@9.5', 'D@12', 'C@13.5', 'D@16']);
    expect(host.textContent).toContain('Bar 1 selected (4 beats)');
  });

  it('Cmd+X empties the range and keeps it for pasting', () => {
    render(ChordsGridPane);
    pointerDown(cell(1), { shiftKey: true }); // beats 1-2 of bar 1
    press(cellInput(), 'x', { metaKey: true });
    expect(chords()).toEqual(['Em@12', 'C@13.5', 'D@16']);
    pointerDown(cell(6));
    press(cellInput(), 'v', { metaKey: true });
    expect(chords()).toEqual(['Em@12', 'C@13.5', 'G@16']); // the paste replaced D
  });

  it('Shift+arrows extend the range; Esc and plain moves drop it', () => {
    render(ChordsGridPane);
    press(cellInput(), 'ArrowRight', { shiftKey: true });
    press(cellInput(), 'ArrowRight', { shiftKey: true });
    expect(host.textContent).toContain('(3 beats)');
    press(cellInput(), 'Escape');
    expect(host.textContent).not.toContain('selected');
    press(cellInput(), 'ArrowLeft', { shiftKey: true });
    press(cellInput(), ' ');
    expect(host.textContent).not.toContain('selected');
  });

  it('Cmd+A selects everything', () => {
    render(ChordsGridPane);
    press(cellInput(), 'a', { metaKey: true });
    expect(host.textContent).toContain('Bars 1–3 selected (9 beats)');
  });
});

describe('Bars that are not four beats', () => {
  // Like real tapMaps: bars of 4, 2, 7 and 3 tapped beats, a bar with only its
  // measure tap (filled in from 4/4), then the final bar line.
  const taps = (start: number, n: number, type: 'section' | 'measure' = 'measure'): TapMapEntry[] =>
    Array.from({ length: n }, (_, k) => ({ time: start + k, type: k === 0 ? type : 'beat' }));
  const ODD: TapMapEntry[] = [
    ...taps(10, 4, 'section'),
    ...taps(14, 2),
    ...taps(16, 7),
    ...taps(23, 3),
    { time: 26, type: 'measure' }, // no beat taps: four even beats to 30
    { time: 30, type: 'measure' },
  ];
  const beatsPerBar = () => [...host.querySelectorAll('[data-bar]')].map((b) => b.querySelectorAll('[data-cell]').length);
  const label = () => cellInput().getAttribute('aria-label');

  beforeEach(() => setSong(ODD));

  it('gives every bar exactly its own beats, spanning that many columns', () => {
    render(ChordsGridPane);
    expect(beatsPerBar()).toEqual([4, 2, 7, 3, 4, 1]);
    const spans = [...host.querySelectorAll('[data-bar]')].map((b) => (b as HTMLElement).style.gridColumn);
    expect(spans).toEqual(['span 4', 'span 2', 'span 7', 'span 3', 'span 4', 'span 1']);
  });

  it('Tab walks bar to bar whatever their length; Space crosses bar lines', () => {
    render(ChordsGridPane);
    press(cellInput(), 'Tab');
    expect(label()).toBe('Chord at bar 2, beat 1');
    press(cellInput(), 'Tab');
    expect(label()).toBe('Chord at bar 3, beat 1');
    for (let i = 0; i < 6; i++) press(cellInput(), ' ');
    expect(label()).toBe('Chord at bar 3, beat 7');
    type(cellInput(), 'E7');
    press(cellInput(), ' ');
    expect(label()).toBe('Chord at bar 4, beat 1');
    expect(chords()).toEqual(['E7@22']);
  });

  it('pushes onto the bar after a two-beat bar land on its "and"', () => {
    render(ChordsGridPane);
    press(cellInput(), 'Tab');
    press(cellInput(), 'Tab'); // bar 3 starts at 16; the beat before is 15
    type(cellInput(), 'A');
    press(cellInput(), '<');
    expect(chords()).toEqual(['A@15.5']);
  });

  it('% copies a long bar into a short one, as much as fits', () => {
    store().open([
      { symbol: 'C', time: 16 },
      { symbol: 'F', time: 18 },
      { symbol: 'G', time: 22 }, // beat 7: doesn't fit in a 3-beat bar
    ]);
    render(ChordsGridPane);
    pointerDown(cell(13)); // bar 4, beat 1
    press(cellInput(), '%');
    expect(chords()).toEqual(['C@16', 'F@18', 'G@22', 'C@23', 'F@25']);
  });

  it('Arrow down keeps the beat column, or stops at the end of a shorter row', () => {
    render(ChordsGridPane);
    // Row 1 is bars 1-4 (16 beats); row 2 is the filled-in bar and the final bar line (5 beats).
    pointerDown(cell(2)); // row 1, column 3
    press(cellInput(), 'ArrowDown');
    expect(label()).toBe('Chord at bar 5, beat 3');
    pointerDown(cell(12)); // row 1, column 13
    press(cellInput(), 'ArrowDown');
    expect(label()).toBe('Chord at bar 6, beat 1');
  });

  it('copes with a whole song in 3/4 with only measure taps', () => {
    useSongStore.getState().setSelectedSong({
      tapMap: [0, 3, 6, 9].map((time, i) => ({ time, type: i === 0 ? 'section' : 'measure', ...(i === 0 ? { label: 'A' } : {}) })),
      timeSignatureMap: [{ beat: 0, numerator: 3, denominator: 4 }],
    } as unknown as SongConfig);
    render(ChordsGridPane);
    expect(beatsPerBar()).toEqual([3, 3, 3, 1]);
    press(cellInput(), 'Tab');
    expect(label()).toBe('Chord at bar 2, beat 1');
  });

  it('treats beats tapped before the first measure (a pickup) as free time', () => {
    setSong([{ time: 9, type: 'beat' }, ...ODD]);
    store().open([{ symbol: 'D', time: 9 }]);
    render(ChordsGridPane);
    expect(beatsPerBar()[0]).toBe(4);
    expect(host.textContent).toContain('Free time:');
  });
});

describe('Stamp mode', () => {
  it('queues chords, stamps them at the playhead with snapping, and takes one back', () => {
    store().setSnap('half');
    render(ChordsStampPane);
    const box = host.querySelector('input[placeholder^="Chords to place"]') as HTMLInputElement;
    type(box, 'g  c7 ');
    press(box, 'Enter');
    expect(store().queue).toEqual(['G', 'C7']);

    engine.clock.currentTime = 12.38; // snaps to 12.5
    press(window, 'Tab');
    engine.clock.currentTime = 3.21; // free time: no snap
    press(window, 'Tab');
    expect(chords()).toEqual(['C7@3.21', 'G@12.5']);

    press(window, 'Tab', { shiftKey: true });
    expect(chords()).toEqual(['G@12.5']);
    expect(store().queue).toEqual(['C7']);
  });

  it('rejects names it does not know, keeping the good ones', () => {
    render(ChordsStampPane);
    const box = host.querySelector('input[placeholder^="Chords to place"]') as HTMLInputElement;
    type(box, 'G Hm D');
    press(box, 'Enter');
    expect(store().queue).toEqual(['G', 'D']);
    expect(host.textContent).toContain('Not chord names I know: Hm');
  });

  it('Shift+click selects a run of rows and Delete removes exactly those', () => {
    store().open([
      { symbol: 'A', time: 1 },
      { symbol: 'B', time: 2 },
      { symbol: 'C', time: 3 },
      { symbol: 'D', time: 4 },
    ]);
    render(ChordsStampPane);
    const row = (t: number) => host.querySelector(`[data-chord-row="${t}"]`) as HTMLElement;
    act(() => row(2).click());
    act(() => row(3).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
    expect(host.textContent).toContain('Delete 2');
    press(window, 'Delete');
    expect(chords()).toEqual(['A@1', 'D@4']);
  });
});

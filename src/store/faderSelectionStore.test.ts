import { beforeEach, describe, expect, it } from 'vitest';
import { gangVolumes, useFaderSelectionStore } from './faderSelectionStore';

const store = () => useFaderSelectionStore.getState();

describe('faderSelectionStore', () => {
  beforeEach(() => {
    store().clear();
    store().setOrder(['a', 'b', 'c', 'd', 'e']);
  });

  it('cmd + click toggles strips in and out', () => {
    store().click('a', { toggle: true, range: false });
    store().click('c', { toggle: true, range: false });
    expect(store().selected).toEqual(['a', 'c']);
    store().click('a', { toggle: true, range: false });
    expect(store().selected).toEqual(['c']);
  });

  it('shift + click selects the run from the last clicked strip', () => {
    store().click('b', { toggle: true, range: false });
    store().click('d', { toggle: false, range: true });
    expect(store().selected).toEqual(['b', 'c', 'd']);
    store().click('a', { toggle: false, range: true });
    expect(store().selected).toEqual(['a', 'b']);
  });

  it('cmd + shift adds the run to what was selected', () => {
    store().click('e', { toggle: true, range: false });
    store().click('a', { toggle: true, range: false });
    store().click('b', { toggle: true, range: true });
    expect(store().selected.sort()).toEqual(['a', 'b', 'e']);
  });

  it('drops strips that are no longer shown', () => {
    store().click('b', { toggle: true, range: false });
    store().click('c', { toggle: true, range: false });
    store().setOrder(['a', 'c']);
    expect(store().selected).toEqual(['c']);
  });
});

describe('gangVolumes', () => {
  it('moves every fader by the leader\'s dB change, clamped at the top', () => {
    // Leader doubles (+6 dB): each fader doubles too, the loud one stops at max.
    expect(gangVolumes({ a: 0.5, b: 0.25, c: 1 }, 'a', 1, 1.5)).toEqual({ a: 1, b: 0.5, c: 1.5 });
  });

  it('leaves a fader at -inf where it is', () => {
    expect(gangVolumes({ a: 1, b: 0 }, 'a', 0.5, 1.5)).toEqual({ a: 0.5, b: 0 });
  });

  it('moves by gain when the leader starts at -inf', () => {
    expect(gangVolumes({ a: 0, b: 0.5 }, 'a', 0.2, 1.5)).toEqual({ a: 0.2, b: 0.7 });
  });

  it('measures from the start, so a pinned fader comes back to its offset', () => {
    const base = { a: 0.5, c: 1 };
    gangVolumes(base, 'a', 1, 1.5);
    expect(gangVolumes(base, 'a', 0.25, 1.5)).toEqual({ a: 0.25, c: 0.5 });
  });

  it('pulling the leader to -inf and back restores everyone', () => {
    const base = { a: 0.5, c: 1 };
    expect(gangVolumes(base, 'a', 0, 1.5)).toEqual({ a: 0, c: 0 });
    expect(gangVolumes(base, 'a', 0.5, 1.5)).toEqual({ a: 0.5, c: 1 });
  });
});

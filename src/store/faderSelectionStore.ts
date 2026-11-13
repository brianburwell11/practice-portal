import { create } from 'zustand';

/**
 * Which desktop mixer faders are selected, Logic-style: cmd/ctrl + click
 * toggles a strip, shift + click selects the run from the last clicked
 * strip. Moving any selected fader moves the rest by the same number of dB.
 *
 * Keys are `stem:<id>` or `group:<id>`; `order` is the strips' left-to-right
 * order as shown (open stacks include their tracks), set by the mixer.
 */
interface FaderSelectionState {
  selected: string[];
  anchor: string | null;
  order: string[];
  /** Updates the visible order, dropping selected strips no longer shown. */
  setOrder: (order: string[]) => void;
  click: (key: string, mods: { toggle: boolean; range: boolean }) => void;
  clear: () => void;
}

export const stemKey = (id: string) => `stem:${id}`;
export const groupKey = (id: string) => `group:${id}`;

export const useFaderSelectionStore = create<FaderSelectionState>((set) => ({
  selected: [],
  anchor: null,
  order: [],
  setOrder: (order) => set((s) => {
    const shown = new Set(order);
    const selected = s.selected.filter((k) => shown.has(k));
    return {
      order,
      selected: selected.length === s.selected.length ? s.selected : selected,
      anchor: s.anchor && shown.has(s.anchor) ? s.anchor : null,
    };
  }),
  click: (key, { toggle, range }) => set((s) => {
    if (range && s.anchor) {
      const a = s.order.indexOf(s.anchor);
      const b = s.order.indexOf(key);
      if (a >= 0 && b >= 0) {
        const run = s.order.slice(Math.min(a, b), Math.max(a, b) + 1);
        // Cmd + shift keeps what was already selected; shift alone selects just the run.
        const base = toggle ? s.selected : [];
        return { selected: [...new Set([...base, ...run])] };
      }
    }
    if (toggle || range) {
      const on = s.selected.includes(key);
      return {
        selected: on ? s.selected.filter((k) => k !== key) : [...s.selected, key],
        anchor: key,
      };
    }
    return { selected: [], anchor: null };
  }),
  clear: () => set({ selected: [], anchor: null }),
}));

/**
 * New volumes for a ganged move, the way Logic links faders: every selected
 * fader moves by the same number of dB as the leader moved since the
 * gesture started, so the balance between them holds. In gain that's one
 * shared ratio. A fader at -∞ stays there. If the leader itself starts at
 * -∞ there's no dB change to share, so the others move by the same gain instead.
 * Measured from the gesture's start, so a fader pinned at the top or
 * bottom picks up where it left off when the move comes back.
 */
export function gangVolumes(
  base: Record<string, number>,
  leader: string,
  leaderValue: number,
  max: number,
): Record<string, number> {
  const start = base[leader] ?? leaderValue;
  const move = start > 0
    ? (v: number) => v * (leaderValue / start)
    : (v: number) => v + (leaderValue - start);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(base)) {
    const next = k === leader ? leaderValue : move(v);
    out[k] = Math.round(Math.max(0, Math.min(max, next)) * 10000) / 10000;
  }
  return out;
}

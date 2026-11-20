/**
 * Where the panels' reading point starts, in viewport px. The current lyric,
 * the current chord, the score's playhead and the first note all sit a small
 * nudge (24px) right of this edge, so they line up with each other.
 *
 * Desktop: the waveform's left edge, so the reading point sits right under
 * where the waveform starts. Tablets: 15% across the screen, further left, so
 * more of what's coming fits on screen. Null before the waveform mounts
 * (no song yet); callers keep their own fallback.
 */
const TABLET_QUERY = '(min-width: 768px) and (pointer: coarse)';
/** Tablets: the reading point (edge plus the 24px nudge) at this share of the screen's width. */
const TABLET_FOCUS_SHARE = 0.15;
const NUDGE_PX = 24;

export function focusEdgeLeft(): number | null {
  const waveformEl = document.querySelector('[data-waveform-timeline]') as HTMLElement | null;
  if (!waveformEl) return null;
  if (window.matchMedia(TABLET_QUERY).matches) {
    return window.innerWidth * TABLET_FOCUS_SHARE - NUDGE_PX;
  }
  return waveformEl.getBoundingClientRect().left;
}

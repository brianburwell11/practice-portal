import { flushSync } from 'react-dom';

/**
 * Opening or closing an on-page editor (tap map, lyrics, chords, band
 * settings) as one movement: the browser snapshots the page, the editor
 * takes the mixer's place (or gives it back), and the slot grows or shrinks
 * between the two while the rest of the page crossfades. See `.editor-slot`
 * in index.css.
 *
 * Where View Transitions aren't supported (and in tests), `update` just runs.
 * Where they are, it runs a frame later, once the old page is captured.
 */
export function editorSwap(update: () => void) {
  if (typeof document === 'undefined' || !('startViewTransition' in document)) {
    update();
    return;
  }
  const root = document.documentElement;
  root.classList.add('editor-swap');
  const t = document.startViewTransition(() => flushSync(update));
  t.finished.finally(() => root.classList.remove('editor-swap'));
}

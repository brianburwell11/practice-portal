// The box every screen renders inside (ScreenTransition), so a loader handing
// over to its page (ui/Loading) can bring the page in the same way a
// navigation does.
let screen: HTMLElement | null = null;

export function setScreenElement(el: HTMLElement | null) {
  screen = el;
}

/**
 * Fade the current screen up from the page color. Opacity only: a transform
 * here would shift the fixed ribbons and the sticky waveform while it ran.
 * Kept under Reduce Motion, since nothing moves.
 */
export function fadeInScreen() {
  if (!screen) return;
  for (const a of screen.getAnimations()) a.cancel();
  screen.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
}

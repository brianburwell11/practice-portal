import { useEffect } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { useSongStore } from '../store/songStore';
import { ControlLabels } from './ControlLabels';
import { isTyping, markTourSeen, tourSeen, useOnboardingStore } from './onboardingStore';
import { Tour } from './Tour';

/**
 * The header's ? button: labels on every control, plus a bar with the
 * keyboard shortcuts, the tour and the Help guides. The ? key does the same.
 */
export function HelpButton() {
  const labelsOpen = useOnboardingStore((s) => s.labelsOpen);
  const toggleLabels = useOnboardingStore((s) => s.toggleLabels);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      toggleLabels();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleLabels]);

  return (
    <button
      onClick={toggleLabels}
      data-tour="help"
      aria-pressed={labelsOpen}
      aria-label="Show what each control does"
      title="What does each control do? (?)"
      className={`shrink-0 size-9 rounded-full flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
        labelsOpen ? 'bg-blue-600 hover:bg-blue-500 text-accent-ink' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
      }`}
    >
      <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9.25" />
        <path d="M9.4 9.2a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.4-2.6 4" />
        <path d="M12 17.25h.01" strokeWidth="2.5" />
      </svg>
    </button>
  );
}

/**
 * The band page's help layer: the ? panel (labels and shortcuts) and the tour. The
 * tour starts by itself the first time someone opens a song on this device
 * (once per person, whichever band), never over an editor.
 */
export function OnboardingLayer({ editorOpen }: { editorOpen: boolean }) {
  const songReady = useSongStore((s) => !!s.selectedSong && !s.loading);
  const sessionLoaded = useSessionStore((s) => s.loaded);
  const userId = useSessionStore((s) => s.user?.id);
  const startTour = useOnboardingStore((s) => s.startTour);
  const endTour = useOnboardingStore((s) => s.endTour);
  const hideLabels = useOnboardingStore((s) => s.hideLabels);

  useEffect(() => {
    if (!sessionLoaded || !songReady || editorOpen) return;
    const person = userId ?? 'device';
    if (tourSeen(person)) return;
    // A beat for the player to settle into its layout first.
    const t = window.setTimeout(() => {
      markTourSeen(person);
      startTour();
    }, 900);
    return () => window.clearTimeout(t);
  }, [sessionLoaded, songReady, editorOpen, userId, startTour]);

  // An editor takes the page over: put the help away.
  useEffect(() => {
    if (!editorOpen) return;
    endTour();
    hideLabels();
  }, [editorOpen, endTour, hideLabels]);

  return (
    <>
      <ControlLabels />
      <Tour />
    </>
  );
}

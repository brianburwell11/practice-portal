import { useEffect } from 'react';
import { useTransportStore } from '../store/transportStore';
import { useNotesStore } from '../store/notesStore';
import { usePersonalNotesStore } from '../store/personalNotesStore';

const ADMIN = import.meta.env.DEV;

/**
 * `n` shortcut: drop a draft note at the current playhead. Routed to the
 * admin store in dev (saved to R2) or the personal store in production
 * (saved to localStorage). Ignored while typing in inputs/textareas and
 * when no song is loaded.
 */
export function useNotesKeyboard() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return;
      const position = useTransportStore.getState().position;
      if (ADMIN) {
        const { loaded, bandId, songId } = useNotesStore.getState();
        if (!loaded || !bandId || !songId) return;
        e.preventDefault();
        useNotesStore.getState().createDraft(position);
      } else {
        const { loaded, songId } = usePersonalNotesStore.getState();
        if (!loaded || !songId) return;
        e.preventDefault();
        usePersonalNotesStore.getState().createDraft(position);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

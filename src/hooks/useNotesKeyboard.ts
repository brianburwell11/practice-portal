import { useEffect } from 'react';
import { useTransportStore } from '../store/transportStore';
import { useNotesStore } from '../store/notesStore';

/**
 * Admin/dev-only `n` shortcut: drop a draft note at the current playhead.
 * Ignored while typing in inputs/textareas and when a song isn't loaded.
 */
export function useNotesKeyboard() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return;
      const { loaded, bandId, songId } = useNotesStore.getState();
      if (!loaded || !bandId || !songId) return;
      e.preventDefault();
      const position = useTransportStore.getState().position;
      useNotesStore.getState().createDraft(position);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

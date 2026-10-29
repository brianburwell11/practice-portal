import { useEffect } from 'react';
import { useTransportStore } from '../store/transportStore';
import { useNotesStore } from '../store/notesStore';
import { useBandStore } from '../store/bandStore';
import { useSessionStore } from '../store/sessionStore';

/**
 * `n` shortcut: drop a draft note at the current playhead, for anyone who
 * may add notes (members, not guests). Ignored while typing in
 * inputs/textareas and when no song is loaded.
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
      const bandId = useBandStore.getState().currentBand?.id;
      if (!useSessionStore.getState().can(bandId, 'note.create')) return;
      const { loaded, songId } = useNotesStore.getState();
      if (!loaded || !songId) return;
      e.preventDefault();
      useNotesStore.getState().createDraft(position);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

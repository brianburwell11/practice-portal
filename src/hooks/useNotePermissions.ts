import { useCallback } from 'react';
import type { Note } from '../audio/types';
import { isDraft } from '../store/notesStore';
import { useCan, useSessionStore } from '../store/sessionStore';

/**
 * Who may do what with a song's notes. Anyone in the band (not a guest) adds
 * notes and edits or deletes their own; Managers and the Owner
 * (`note.moderate`) edit or delete anyone's. UX only: the server checks too.
 */
export function useNotePermissions() {
  const canAdd = useCan('note.create');
  const canModerate = useCan('note.moderate');
  const myId = useSessionStore((s) => s.user?.id);
  const canEdit = useCallback(
    (note: Note) => isDraft(note.id) || (canAdd && (canModerate || (!!myId && note.author?.id === myId))),
    [canAdd, canModerate, myId],
  );
  return { canAdd, canEdit };
}

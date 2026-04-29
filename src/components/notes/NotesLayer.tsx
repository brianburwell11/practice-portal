import { useEffect, useMemo, useRef, useState } from 'react';
import { useTransportStore } from '../../store/transportStore';
import {
  useNotesStore,
  NOTE_COLOR,
  NOTE_LEAD_SECONDS,
  NOTE_TAIL_SECONDS,
} from '../../store/notesStore';
import type { Note } from '../../audio/types';

const ADMIN = import.meta.env.DEV;
const FADE_IN_MS = 250;

/** Pixels to nudge the first sticky right of the waveform's left edge so
 *  it lines up with the focused lyric. Keep in sync with the same
 *  constant in `LyricsDisplay.tsx` and `ScrollingScore.tsx`. */
const FOCUS_LEFT_NUDGE_PX = 24;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function NotesLayer() {
  const position = useTransportStore((s) => s.position);
  const notes = useNotesStore((s) => s.notes);
  const dirty = useNotesStore((s) => s.dirty);

  // Notes whose timestamp window contains the playhead, plus any
  // dirty (admin-only) drafts that should stay visible until saved.
  // Sorted newest-first so a freshly-added note lands at the left of
  // the row and the layout collapses immediately when one leaves.
  const visible = useMemo(() => {
    const matching = notes.filter((n) => {
      if (ADMIN && dirty.has(n.id)) return true;
      return (
        position >= n.time - NOTE_LEAD_SECONDS &&
        position <= n.time + NOTE_TAIL_SECONDS
      );
    });
    return [...matching].sort((a, b) => b.time - a.time);
  }, [notes, dirty, position]);

  // Track the waveform's left edge so the first sticky lines up with the
  // focused-lyric reading point (waveform.left + FOCUS_LEFT_NUDGE_PX).
  const [leftPadding, setLeftPadding] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const waveformEl = document.querySelector('[data-waveform-timeline]') as HTMLElement | null;
      if (!waveformEl) return;
      const rect = waveformEl.getBoundingClientRect();
      setLeftPadding(rect.left + FOCUS_LEFT_NUDGE_PX);
    };
    measure();
    const waveformEl = document.querySelector('[data-waveform-timeline]');
    if (!waveformEl) return;
    const ro = new ResizeObserver(measure);
    ro.observe(waveformEl);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  if (visible.length === 0) return null;

  return (
    <div
      className="pr-4 pb-2 pt-2 flex flex-col md:flex-row md:items-start md:flex-wrap gap-2 shrink-0"
      style={{ paddingLeft: leftPadding ?? 16 }}
    >
      {visible.map((note) => (
        <Sticky key={note.id} note={note} isDirty={dirty.has(note.id)} />
      ))}
    </div>
  );
}

interface StickyProps {
  note: Note;
  isDirty: boolean;
}

function Sticky({ note, isDirty }: StickyProps) {
  const setText = useNotesStore((s) => s.setText);
  const saveNote = useNotesStore((s) => s.saveNote);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Drives the fade-IN: stays false until after first paint so the
  // transition has a non-zero starting opacity to animate from.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Auto-focus a freshly created empty draft so admin can start typing.
  const autoFocusedRef = useRef(false);
  useEffect(() => {
    if (autoFocusedRef.current) return;
    if (ADMIN && isDirty && note.text === '' && textareaRef.current) {
      textareaRef.current.focus();
      autoFocusedRef.current = true;
    }
  }, [isDirty, note.text]);

  const handleSave = async () => {
    if (busy) return;
    setError(null);
    setBusy('saving');
    try {
      await saveNote(note.id);
    } catch (err: any) {
      setError(err?.message ?? 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    setError(null);
    setBusy('deleting');
    try {
      await deleteNote(note.id);
    } catch (err: any) {
      setError(err?.message ?? 'Delete failed');
      setBusy(null);
    }
    // No setBusy(null) on success — the component unmounts when the note's gone.
  };

  return (
    <div
      className={`rounded-md shadow-md text-gray-900 flex flex-col w-full md:w-[calc(30ch+1rem)] transition-opacity ease-out ${
        entered ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ backgroundColor: NOTE_COLOR, transitionDuration: `${FADE_IN_MS}ms` }}
    >
      <div className="flex items-center justify-between px-2 pt-1.5 pb-1 text-[11px] font-mono text-gray-700">
        <span>{formatTime(note.time)}</span>
        {ADMIN && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={!!busy}
            title="Delete note"
            className="text-red-600 hover:text-red-700 disabled:opacity-40 leading-none text-base px-1"
          >
            &times;
          </button>
        )}
      </div>

      {ADMIN ? (
        <textarea
          ref={textareaRef}
          value={note.text}
          onChange={(e) => setText(note.id, e.target.value)}
          placeholder="Note…"
          rows={2}
          maxLength={60}
          className="resize-none bg-transparent outline-none px-2 pb-1 text-sm leading-snug text-gray-900 placeholder-gray-600/60"
        />
      ) : (
        <div className="px-2 pb-2 text-sm leading-snug whitespace-pre-wrap line-clamp-2 text-gray-900">
          {note.text}
        </div>
      )}

      {ADMIN && (isDirty || error) && (
        <div className="flex items-center justify-between px-2 pb-1.5 gap-2">
          {error ? (
            <span className="text-[11px] text-red-700 truncate">{error}</span>
          ) : (
            <span className="text-[11px] text-gray-700/80">Unsaved</span>
          )}
          {isDirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!!busy}
              className="text-xs px-2 py-0.5 rounded bg-gray-900 text-yellow-100 hover:bg-gray-800 disabled:opacity-50"
            >
              {busy === 'saving' ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

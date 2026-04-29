import { useEffect, useMemo, useRef, useState } from 'react';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { usePanelMinimizeStore } from '../../store/panelMinimizeStore';
import {
  useNotesStore,
  NOTE_COLOR,
  NOTE_LEAD_SECONDS,
  NOTE_TAIL_SECONDS,
} from '../../store/notesStore';
import {
  usePersonalNotesStore,
  PERSONAL_NOTE_COLOR,
} from '../../store/personalNotesStore';
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

/** Parse `mm:ss[.fraction]` or a bare seconds value. Returns null if unparseable. */
function parseTimeInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (m) {
    const minutes = parseInt(m[1], 10);
    const seconds = parseFloat(m[2]);
    if (!isFinite(seconds) || seconds >= 60) return null;
    return minutes * 60 + seconds;
  }
  const n = parseFloat(s);
  return isFinite(n) && n >= 0 ? n : null;
}

interface NoteActions {
  setText: (id: string, text: string) => void;
  setTime: (id: string, time: number) => void;
  saveNote: (id: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
}

interface StickyTheme {
  bg: string;
  /** RGB triplet (no `rgb()` wrapper) used by the note-pulse keyframe to
   *  color its box-shadow halo for this theme. */
  pulseRgb: string;
  textClass: string;
  mutedTextClass: string;
  placeholderClass: string;
  saveButtonClass: string;
  errorTextClass: string;
  deleteButtonClass: string;
  inputClass: string;
}

const ADMIN_THEME: StickyTheme = {
  bg: NOTE_COLOR,
  pulseRgb: '255, 224, 102',
  textClass: 'text-gray-900',
  mutedTextClass: 'text-gray-700',
  placeholderClass: 'placeholder-gray-600/60',
  saveButtonClass: 'bg-gray-900 text-yellow-100 hover:bg-gray-800',
  errorTextClass: 'text-red-700',
  deleteButtonClass: 'text-red-600 hover:text-red-700',
  inputClass: 'bg-yellow-100/60 border-gray-700/30 focus:border-gray-700 text-gray-900',
};

const PERSONAL_THEME: StickyTheme = {
  bg: PERSONAL_NOTE_COLOR,
  pulseRgb: '59, 130, 246',
  textClass: 'text-blue-50',
  mutedTextClass: 'text-blue-100',
  placeholderClass: 'placeholder-blue-200/70',
  saveButtonClass: 'bg-blue-900 text-blue-50 hover:bg-blue-800',
  errorTextClass: 'text-red-200',
  deleteButtonClass: 'text-red-200 hover:text-red-50',
  inputClass: 'bg-blue-300/30 border-blue-100/40 focus:border-blue-50 text-blue-50',
};

interface VisibleEntry {
  note: Note;
  kind: 'admin' | 'personal';
  isDirty: boolean;
  editable: boolean;
  theme: StickyTheme;
  actions: NoteActions;
}

export function NotesLayer() {
  const position = useTransportStore((s) => s.position);
  const adminNotes = useNotesStore((s) => s.notes);
  const adminDirty = useNotesStore((s) => s.dirty);
  const adminLoaded = useNotesStore((s) => s.loaded);
  const adminActions: NoteActions = {
    setText: useNotesStore((s) => s.setText),
    setTime: useNotesStore((s) => s.setTime),
    saveNote: useNotesStore((s) => s.saveNote),
    deleteNote: useNotesStore((s) => s.deleteNote),
  };

  const personalNotes = usePersonalNotesStore((s) => s.notes);
  const personalDirty = usePersonalNotesStore((s) => s.dirty);
  const personalLoaded = usePersonalNotesStore((s) => s.loaded);
  const personalActions: NoteActions = {
    setText: usePersonalNotesStore((s) => s.setText),
    setTime: usePersonalNotesStore((s) => s.setTime),
    saveNote: usePersonalNotesStore((s) => s.saveNote),
    deleteNote: usePersonalNotesStore((s) => s.deleteNote),
  };

  // Combined visible set across both stores. Admin notes are read-only
  // for non-admin viewers; personal notes are editable for everyone.
  // Dirty notes (drafts/edits) stay visible until saved so the editor
  // has time to type. Sorted earliest-first so the chronologically
  // earliest sticky lands on the left.
  const visible: VisibleEntry[] = useMemo(() => {
    const inWindow = (n: Note) =>
      position >= n.time - NOTE_LEAD_SECONDS && position <= n.time + NOTE_TAIL_SECONDS;

    const out: VisibleEntry[] = [];
    for (const n of adminNotes) {
      if (ADMIN && adminDirty.has(n.id)) {
        out.push({ note: n, kind: 'admin', isDirty: true, editable: true, theme: ADMIN_THEME, actions: adminActions });
      } else if (inWindow(n)) {
        out.push({ note: n, kind: 'admin', isDirty: false, editable: ADMIN, theme: ADMIN_THEME, actions: adminActions });
      }
    }
    for (const n of personalNotes) {
      if (personalDirty.has(n.id) || inWindow(n)) {
        out.push({
          note: n,
          kind: 'personal',
          isDirty: personalDirty.has(n.id),
          editable: true,
          theme: PERSONAL_THEME,
          actions: personalActions,
        });
      }
    }
    return out.sort((a, b) => a.note.time - b.note.time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminNotes, adminDirty, personalNotes, personalDirty, position]);

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

  const selectedSong = useSongStore((s) => s.selectedSong);
  const minimized = usePanelMinimizeStore((s) =>
    s.items.some((x) => x.kind === 'panel' && x.id === 'notes'),
  );
  const minimizePanel = usePanelMinimizeStore((s) => s.minimizePanel);

  if (minimized) return null;

  // Add-note button is always visible (admin: yellow, viewer: blue) so
  // the layer renders even when no stickies are currently in view.
  const addReady = ADMIN ? adminLoaded : personalLoaded;
  const addTheme = ADMIN ? ADMIN_THEME : PERSONAL_THEME;
  const addIconClass = ADMIN ? 'text-gray-900' : 'text-white';

  const handleAdd = () => {
    const pos = useTransportStore.getState().position;
    if (ADMIN) {
      if (!useNotesStore.getState().loaded) return;
      useNotesStore.getState().createDraft(pos);
    } else {
      if (!usePersonalNotesStore.getState().loaded) return;
      usePersonalNotesStore.getState().createDraft(pos);
    }
  };

  const handleExport = () => {
    const all = useNotesStore.getState().notes;
    if (all.length === 0) return;
    const sorted = [...all].sort((a, b) => a.time - b.time);
    const body = sorted.map((n) => `${formatTime(n.time)}\t${n.text}`).join('\n') + '\n';
    const slug = selectedSong?.slug ?? selectedSong?.id ?? 'song';
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-notes.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="pr-4 pb-2 pt-2 flex flex-col md:flex-row md:items-start md:flex-wrap gap-2 shrink-0"
      style={{ paddingLeft: leftPadding ?? 16 }}
    >
      <AddNoteButton
        onClick={handleAdd}
        disabled={!addReady}
        bg={addTheme.bg}
        iconClass={addIconClass}
      />
      {visible.map((entry) => (
        <Sticky
          key={`${entry.kind}:${entry.note.id}`}
          note={entry.note}
          isDirty={entry.isDirty}
          editable={entry.editable}
          theme={entry.theme}
          actions={entry.actions}
        />
      ))}
      <div className="flex items-center gap-2 md:ml-auto md:self-center">
        {ADMIN && <ExportButton onClick={handleExport} disabled={adminNotes.length === 0} />}
        <MinimizeButton onClick={() => minimizePanel('notes')} />
      </div>
    </div>
  );
}

function MinimizeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Minimize notes"
      aria-label="Minimize notes"
      className="flex items-center justify-center rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200 transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="19" x2="19" y2="19" />
      </svg>
    </button>
  );
}

function ExportButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Download all notes as a .txt file"
      className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
    >
      Export .txt
    </button>
  );
}

function AddNoteButton({
  onClick,
  disabled,
  bg,
  iconClass,
}: {
  onClick: () => void;
  disabled: boolean;
  bg: string;
  iconClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Add a note (N)"
      aria-label="Add a note"
      // On desktop, pull the button left by its own width + the flex gap
      // (40px + 8px) so the first sticky still lands at the focused-lyric
      // edge. On mobile (flex-col) the button stacks above the stickies,
      // so the negative margin doesn't apply.
      className={`w-10 h-10 rounded-lg flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition hover:brightness-110 shrink-0 shadow-md md:-ml-12 ${iconClass}`}
      style={{ backgroundColor: bg }}
    >
      <svg
        className="w-5 h-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
        <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    </button>
  );
}

interface StickyProps {
  note: Note;
  isDirty: boolean;
  editable: boolean;
  theme: StickyTheme;
  actions: NoteActions;
}

function Sticky({ note, isDirty, editable, theme, actions }: StickyProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulsing, setPulsing] = useState(false);
  const [editingTime, setEditingTime] = useState(false);
  const [timeInput, setTimeInput] = useState('');

  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Fresh-draft pulse: confirms the placement when the user just dropped
  // a note via N or the add button. We can't rely on the cross-over
  // subscription below because the playhead is already at note.time the
  // moment we mount.
  useEffect(() => {
    if (isDirty && note.text === '') {
      setPulsing(true);
      const t = window.setTimeout(() => setPulsing(false), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-over pulse: fires when the playhead crosses this note's exact
  // timestamp during playback (or scrub). Subscribes imperatively so the
  // sticky doesn't re-render on every position tick.
  useEffect(() => {
    let prev = useTransportStore.getState().position;
    let timeoutId: number | null = null;
    const unsubscribe = useTransportStore.subscribe((s) => {
      const curr = s.position;
      if (prev < note.time && curr >= note.time && curr - note.time < 1) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        setPulsing(true);
        timeoutId = window.setTimeout(() => setPulsing(false), 600);
      }
      prev = curr;
    });
    return () => {
      unsubscribe();
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [note.time]);

  // Auto-focus a freshly created empty draft so user can start typing.
  const autoFocusedRef = useRef(false);
  useEffect(() => {
    if (autoFocusedRef.current) return;
    if (editable && isDirty && note.text === '' && textareaRef.current) {
      textareaRef.current.focus();
      autoFocusedRef.current = true;
    }
  }, [editable, isDirty, note.text]);

  const handleSave = async () => {
    if (busy) return;
    setError(null);
    setBusy('saving');
    try {
      await actions.saveNote(note.id);
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
      await actions.deleteNote(note.id);
    } catch (err: any) {
      setError(err?.message ?? 'Delete failed');
      setBusy(null);
    }
  };

  const startTimeEdit = () => {
    setTimeInput(formatTime(note.time));
    setEditingTime(true);
  };
  const commitTimeEdit = () => {
    setEditingTime(false);
    const parsed = parseTimeInput(timeInput);
    if (parsed !== null && parsed !== note.time) actions.setTime(note.id, parsed);
  };

  return (
    <div
      className={`rounded-md shadow-md flex flex-col w-full md:w-[calc(30ch+1rem)] transition-opacity ease-out ${theme.textClass} ${
        entered ? 'opacity-100' : 'opacity-0'
      }`}
      style={{
        backgroundColor: theme.bg,
        transitionDuration: `${FADE_IN_MS}ms`,
        animation: pulsing ? 'note-pulse 600ms ease-out' : undefined,
        ['--pulse-rgb' as any]: theme.pulseRgb,
      }}
    >
      <div className={`flex items-center justify-between px-2 pt-1.5 pb-1 text-[11px] font-mono ${theme.mutedTextClass}`}>
        {editable && editingTime ? (
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={timeInput}
            onChange={(e) => setTimeInput(e.target.value)}
            onBlur={commitTimeEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitTimeEdit(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditingTime(false); }
            }}
            className={`w-[6ch] border rounded px-1 outline-none font-mono text-[11px] ${theme.inputClass}`}
          />
        ) : editable ? (
          <button
            type="button"
            onClick={startTimeEdit}
            title="Edit timestamp"
            className={`hover:${theme.textClass} cursor-text`}
          >
            {formatTime(note.time)}
          </button>
        ) : (
          <span>{formatTime(note.time)}</span>
        )}
        {editable && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={!!busy}
            title="Delete note"
            className={`disabled:opacity-40 leading-none text-base px-1 ${theme.deleteButtonClass}`}
          >
            &times;
          </button>
        )}
      </div>

      <textarea
        ref={textareaRef}
        value={note.text}
        readOnly={!editable}
        onChange={editable ? (e) => actions.setText(note.id, e.target.value) : undefined}
        onKeyDown={editable ? (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (isDirty && !busy) handleSave();
          }
        } : undefined}
        placeholder={editable ? 'Note…' : undefined}
        rows={2}
        maxLength={editable ? 60 : undefined}
        className={`resize-none bg-transparent outline-none px-2 pb-1 text-sm leading-snug ${theme.textClass} ${theme.placeholderClass} ${
          editable ? '' : 'cursor-default'
        }`}
      />

      {editable && (isDirty || error) && (
        <div className="flex items-center justify-between px-2 pb-1.5 gap-2">
          {error ? (
            <span className={`text-[11px] truncate ${theme.errorTextClass}`}>{error}</span>
          ) : (
            <span className={`text-[11px] ${theme.mutedTextClass}`}>Unsaved</span>
          )}
          {isDirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!!busy}
              className={`text-xs px-2 py-0.5 rounded disabled:opacity-50 ${theme.saveButtonClass}`}
            >
              {busy === 'saving' ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

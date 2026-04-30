import { useEffect, useState } from 'react';
import { useNotesStore } from '../../store/notesStore';
import { usePersonalNotesStore } from '../../store/personalNotesStore';

const TOAST_MS = 5000;

/**
 * Bottom-floating toast offering Undo for the most recently deleted note.
 * Subscribes to both stores (admin + personal) and shows whichever
 * deletion was more recent. Auto-dismisses after TOAST_MS.
 */
export function UndoToast() {
  const adminDeleted = useNotesStore((s) => s.lastDeleted);
  const adminUndo = useNotesStore((s) => s.undoDelete);
  const adminClear = useNotesStore((s) => s.clearLastDeleted);
  const personalDeleted = usePersonalNotesStore((s) => s.lastDeleted);
  const personalUndo = usePersonalNotesStore((s) => s.undoDelete);
  const personalClear = usePersonalNotesStore((s) => s.clearLastDeleted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick whichever deletion happened more recently.
  let active: 'admin' | 'personal' | null = null;
  if (adminDeleted && personalDeleted) {
    active = adminDeleted.deletedAt >= personalDeleted.deletedAt ? 'admin' : 'personal';
  } else if (adminDeleted) {
    active = 'admin';
  } else if (personalDeleted) {
    active = 'personal';
  }
  const lastDeleted = active === 'admin' ? adminDeleted : active === 'personal' ? personalDeleted : null;
  const undoDelete = active === 'admin' ? adminUndo : personalUndo;
  const clearLastDeleted = active === 'admin' ? adminClear : personalClear;

  // Auto-dismiss after TOAST_MS based on the deletedAt timestamp.
  useEffect(() => {
    if (!lastDeleted) return;
    setError(null);
    const elapsed = Date.now() - lastDeleted.deletedAt;
    const remaining = Math.max(0, TOAST_MS - elapsed);
    const t = window.setTimeout(() => clearLastDeleted(), remaining);
    return () => clearTimeout(t);
  }, [lastDeleted, clearLastDeleted]);

  if (!lastDeleted) return null;

  const preview = lastDeleted.note.text.trim() || '(empty)';
  const trimmed = preview.length > 40 ? `${preview.slice(0, 37)}…` : preview;

  const handleUndo = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await undoDelete();
    } catch (err: any) {
      setError(err?.message ?? 'Undo failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg bg-gray-900/95 border border-gray-700 px-3 py-2 shadow-lg text-sm text-gray-100">
        <span className="text-gray-300">
          Note deleted: <span className="text-gray-100">{trimmed}</span>
        </span>
        {error && <span className="text-red-400 text-xs">{error}</span>}
        <button
          type="button"
          onClick={handleUndo}
          disabled={busy}
          className="text-yellow-300 hover:text-yellow-200 font-medium disabled:opacity-50"
        >
          {busy ? 'Restoring…' : 'Undo'}
        </button>
        <button
          type="button"
          onClick={clearLastDeleted}
          title="Dismiss"
          aria-label="Dismiss"
          className="text-gray-400 hover:text-gray-200 leading-none px-1"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

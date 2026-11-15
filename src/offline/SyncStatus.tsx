import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '../components/ui/Modal';
import { confirmDialog } from '../store/dialogStore';
import { signInHref } from '../store/sessionStore';
import { useConnectivity } from './connectivity';
import type { PendingEdit } from './editStore';
import { mergeConfig, partName } from './merge';
import { discardOthersEdits, getConflict, keepMine, keepTheirs } from './sync';

/**
 * The header's word on syncing: "Offline", "3 changes waiting",
 * "Syncing...", "1 needs a decision", or nothing when all is well. A
 * decision opens the conflict dialog, which also opens by itself when one
 * turns up.
 */
export function SyncStatus() {
  const { online, pending, conflicts, syncing, needsSignIn, held, heldFor } = useConnectivity();
  const [chosen, setChosen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // A new conflict asks straight away; "Decide later" leaves it in the header.
  const open = chosen ?? conflicts.find((c) => !dismissed.has(c.id))?.id ?? null;
  const later = (id: string) => { setDismissed((d) => new Set(d).add(id)); setChosen(null); };

  const waiting = pending === 1 ? '1 change waiting' : `${pending} changes waiting`;
  // Full words where there's room; short ones on a phone's top row.
  let full = '';
  let short = '';
  let tone = 'text-gray-400';
  if (needsSignIn) {
    [full, short] = [`Sign in to sync ${waiting}`, 'Sign in to sync'];
    tone = 'text-yellow-400';
  } else if (conflicts.length > 0) {
    [full, short] = [conflicts.length === 1 ? '1 needs a decision' : `${conflicts.length} need a decision`, `${conflicts.length} to decide`];
    tone = 'text-yellow-400';
  } else if (syncing && online) {
    [full, short] = ['Syncing...', 'Syncing...'];
  } else if (!online) {
    [full, short] = pending > 0 ? [`Offline · ${waiting}`, `Offline · ${pending}`] : ['Offline', 'Offline'];
  } else if (pending > 0) {
    [full, short] = [waiting, `${pending} waiting`];
  }
  const words = <><span className="hidden md:inline">{full}</span><span className="md:hidden">{short}</span></>;
  const hint = !online && pending > 0 ? `${full}. Saved on this device; syncs when you’re back online.` : full;

  return (
    <>
      {full && (
        <span role="status" className={`shrink-0 text-xs whitespace-nowrap ${tone}`} title={hint}>
          {needsSignIn ? (
            <a href={signInHref()} className="underline underline-offset-2">{words}</a>
          ) : conflicts.length > 0 ? (
            <button onClick={() => { setDismissed(new Set()); setChosen(conflicts[0].id); }} className="underline underline-offset-2">{words}</button>
          ) : words}
        </span>
      )}
      {held > 0 && <HeldForOthers count={held} names={heldFor} />}
      {/* At the page's top level: the header's centered group is transformed,
          which would trap the dialog under the waveform. */}
      {open && createPortal(
        <ConflictDialog
          key={open}
          editId={open}
          onDone={() => setChosen(null)}
          onLater={() => later(open)}
        />,
        document.body,
      )}
    </>
  );
}

/**
 * Edits another account left on this device: held for them to send when they
 * sign in here again, never sent as yours. Discarding is a choice, with a
 * confirmation.
 */
function HeldForOthers({ count, names }: { count: number; names: string[] }) {
  const who = names.length === 1 ? names[0] : 'other accounts';
  const changes = count === 1 ? '1 change' : `${count} changes`;
  const discard = async () => {
    if (!(await confirmDialog({
      title: `Discard ${changes} from ${who}?`,
      message: `${changes === '1 change' ? 'It was' : 'They were'} saved on this device by ${who} and ${count === 1 ? 'hasn’t' : 'haven’t'} reached the server. ${count === 1 ? 'It syncs' : 'They sync'} if ${names.length === 1 ? 'they sign' : 'those accounts sign'} in here again. Discarding can’t be undone.`,
      confirmLabel: 'Discard',
      danger: true,
    }))) return;
    await discardOthersEdits();
  };
  return (
    <button onClick={discard} className="shrink-0 text-xs whitespace-nowrap text-gray-500 hover:text-gray-300 underline underline-offset-2" title={`${changes} saved on this device by ${who}`}>
      <span className="hidden md:inline">{changes} waiting for {who}</span>
      <span className="md:hidden">{count} held</span>
    </button>
  );
}

const lyricsText = (doc: unknown): string[] => {
  const lines = (doc as { lines?: { text: string; instrumental?: boolean }[] } | null)?.lines ?? [];
  return lines.map((l) => (l.instrumental ? '(instrumental)' : l.text));
};

const chordCount = (doc: unknown): number => ((doc as { chords?: unknown[] } | null)?.chords ?? []).length;

/** One document both you and someone else changed: which copy stays. */
function ConflictDialog({ editId, onDone, onLater }: { editId: string; onDone: () => void; onLater: () => void }) {
  const [edit, setEdit] = useState<PendingEdit | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getConflict(editId).then((e) => { if (!cancelled) setEdit(e?.conflict ? e : null); });
    return () => { cancelled = true; };
  }, [editId]);

  // Already settled (by another tab, say): nothing to ask.
  useEffect(() => {
    if (edit === null) onLater();
  }, [edit, onLater]);

  if (!edit?.conflict) return null;
  const theirs = edit.conflict.current;
  const isLyrics = edit.key.endsWith('/lyrics.json');
  const isChords = edit.key.endsWith('/chords.json');

  let detail: React.ReactNode = null;
  if (isLyrics) {
    detail = (
      <div className="grid grid-cols-2 gap-3 text-xs">
        {([['Yours', edit.data], ['Theirs', theirs]] as const).map(([name, doc]) => (
          <div key={name} className="min-w-0">
            <div className="mb-1 font-medium text-gray-300">{name}</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-800 p-2 font-sans text-gray-200">
              {doc === null ? 'No lyrics' : lyricsText(doc).join('\n') || 'No lyrics'}
            </pre>
          </div>
        ))}
      </div>
    );
  } else if (isChords) {
    detail = <p className="text-sm text-gray-300">Yours has {chordCount(edit.data)} chords; theirs has {chordCount(theirs)}.</p>;
  } else if (edit.kind === 'config' && edit.base && theirs) {
    const result = mergeConfig(edit.base as Record<string, unknown>, edit.data as Record<string, unknown>, theirs as Record<string, unknown>);
    if (!result.ok) detail = <p className="text-sm text-gray-300">You both changed: {result.keys.map(partName).join(', ')}.</p>;
  }

  const choose = async (keep: 'mine' | 'theirs') => {
    setBusy(true);
    try {
      await (keep === 'mine' ? keepMine(editId) : keepTheirs(editId));
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <Modal
      onClose={onLater}
      dismissible={!busy}
      title={`${edit.label} changed while you were away`}
      className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6 space-y-4"
    >
      <p className="text-sm text-gray-400">Someone else saved a change to this while yours was waiting. Which one should stay?</p>
      {detail}
      <div className="flex flex-wrap justify-end gap-2">
        <button onClick={onLater} disabled={busy} className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50">Decide later</button>
        <button onClick={() => choose('theirs')} disabled={busy} className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 disabled:opacity-50">Keep theirs</button>
        <button onClick={() => choose('mine')} disabled={busy} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white disabled:opacity-50">Keep mine</button>
      </div>
    </Modal>
  );
}

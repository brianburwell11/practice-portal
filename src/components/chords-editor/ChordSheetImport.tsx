import { useMemo, useRef, useState } from 'react';
import { displayChord } from '../../audio/chordSymbols';
import { parseChordSheet, sheetToQueue } from '../../audio/chordSheet';
import type { QueueItem } from '../../store/chordsEditorStore';

/** Files a chord sheet usually comes in. */
const SHEET_FILES = '.cho,.chopro,.chordpro,.pro,.crd,.txt,text/plain';

/**
 * Paste or upload a chord sheet (ChordPro, Ultimate Guitar style, or a plain
 * list), see what was read, and add it to the Stamp queue. Sheets carry no
 * timing, so stamping is how the chords get their times.
 */
export function ChordSheetImport({ onAdd, onClose }: { onAdd: (items: QueueItem[]) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseChordSheet(text), [text]);
  const count = parsed.sections.reduce((n, s) => n + s.chords.length, 0);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 512 * 1024) {
      setFileError('That file is too big to be a chord sheet.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFileError(null);
      setText(String(reader.result ?? ''));
    };
    reader.onerror = () => setFileError('Couldn’t read that file.');
    reader.readAsText(file);
  };

  const btn = 'rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-gray-300 px-3 py-1.5';

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 space-y-2" aria-label="Import a chord sheet">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-200">Import a chord sheet</span>
        <span className="flex-1" />
        <button type="button" className={btn} onClick={() => fileRef.current?.click()}>Upload file</button>
        <input ref={fileRef} type="file" accept={SHEET_FILES} className="hidden" onChange={onFile} />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        spellCheck={false}
        placeholder={'Paste a sheet: ChordPro ([G]words), chords over lyrics with [Verse] headings, or just a list of chords.'}
        className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs font-mono text-gray-100 placeholder:text-gray-500"
      />
      {fileError && <p className="text-xs text-red-400">{fileError}</p>}

      {text.trim() && (
        <div className="max-h-40 overflow-y-auto space-y-1 text-sm" aria-label="What was read">
          {parsed.sections.length === 0 && <p className="text-xs text-gray-500">No chords found in that text.</p>}
          {parsed.sections.map((s, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {s.name && <span className="text-xs font-semibold text-amber-500">{s.name}</span>}
              {s.chords.map((c, j) => (
                <span key={j} className="font-semibold text-gray-200">{displayChord(c)}</span>
              ))}
            </div>
          ))}
          {parsed.unknown.length > 0 && (
            <p className="text-xs text-red-400">Skipped, not chord names I know: {parsed.unknown.join(', ')}</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white px-3 py-1.5"
          disabled={count === 0}
          onClick={() => onAdd(sheetToQueue(parsed))}
        >
          {count === 0 ? 'Add to queue' : `Add ${count} ${count === 1 ? 'chord' : 'chords'} to queue`}
        </button>
      </div>
    </div>
  );
}

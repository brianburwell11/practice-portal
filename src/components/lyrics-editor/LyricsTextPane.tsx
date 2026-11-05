import { useEffect, useRef, useState } from 'react';
import { useLyricsEditorStore, nextNonBlankIndex } from '../../store/lyricsEditorStore';
import { LYRIC_SECTIONS, isEndMarker } from '../../audio/lyricSections';
import { linesToText, mergeLyricTimes, textToLines } from '../../audio/lyricsMerge';

/**
 * Lyrics mode: the words in one text box, one lyric per line. Edits keep
 * the timestamps of every line whose text is unchanged since the box was
 * opened; only changed and new lines need timing again.
 */
export function LyricsTextPane() {
  const lines = useLyricsEditorStore((s) => s.lines);
  const replaceLines = useLyricsEditorStore((s) => s.replaceLines);

  // What the times are matched against: the lines as they were when the
  // box opened, so typing a line back to its old text restores its time.
  const [baseline] = useState(() => lines);
  const [text, setText] = useState(() => linesToText(lines));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const sectionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sectionMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!sectionMenuRef.current?.contains(e.target as Node)) setSectionMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [sectionMenuOpen]);

  const update = (next: string) => {
    setText(next);
    replaceLines(mergeLyricTimes(baseline, textToLines(next)));
  };

  // Insert whole lines after the line the cursor is on, then put the
  // cursor at the end of what was inserted.
  const insertLinesAtCursor = (block: string[]) => {
    const ta = textareaRef.current;
    const pos = ta ? ta.selectionEnd : text.length;
    const lineEnd = text.indexOf('\n', pos);
    const at = lineEnd === -1 ? text.length : lineEnd;
    const insert = (text === '' ? '' : '\n') + block.join('\n');
    const next = text.slice(0, at) + insert + text.slice(at);
    update(next);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const caret = at + insert.length;
      ta.setSelectionRange(caret, caret);
    });
  };

  const stampable = lines.filter((l, i) => nextNonBlankIndex(lines, i) === i && !isEndMarker(l.text));
  const timed = stampable.filter((l) => l.time !== null).length;
  const hadTimes = baseline.some((l) => l.time !== null);

  const btn = 'px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors';

  return (
    <div className="flex-1 min-h-0 flex flex-col max-w-2xl w-full mx-auto px-3 md:px-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div ref={sectionMenuRef} className="relative">
          <button className={btn} onClick={() => setSectionMenuOpen((v) => !v)} title="Insert a section marker (#VERSE, #CHORUS, etc.)">
            + Section ▾
          </button>
          {sectionMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-20 min-w-[10rem] rounded border border-gray-600 bg-gray-800 shadow-lg py-1">
              {LYRIC_SECTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => { setSectionMenuOpen(false); insertLinesAtCursor([`#${s}`]); }}
                  className="block w-full text-left px-3 py-2 md:py-1 text-sm md:text-xs font-mono text-purple-300 hover:bg-gray-700 transition-colors"
                >
                  #{s}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className={btn}
          onClick={() => insertLinesAtCursor(['#INSTRUMENTAL'])}
          title="Insert an instrumental gap, shown as a music note in the song view"
        >
          + Instrumental
        </button>
        <span className="ml-auto text-xs text-gray-500">
          {timed} of {stampable.length} lines timed
          {hadTimes && timed < stampable.length && `, ${stampable.length - timed} need timing`}
        </span>
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => update(e.target.value)}
        placeholder={'Paste or type the lyrics here, one line per lyric.\n\nLeave a blank line between sections.'}
        spellCheck={false}
        autoCapitalize="sentences"
        className="flex-1 min-h-[8rem] w-full resize-none rounded-lg border border-gray-700 bg-gray-900/60 p-3 text-base md:text-sm leading-relaxed text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
      />

      <p className="mt-2 text-xs text-gray-500">
        One lyric per line. Blank lines are gaps. Lines like #VERSE are section markers and never show in the song view. #END marks where the lyrics stop.
      </p>
    </div>
  );
}

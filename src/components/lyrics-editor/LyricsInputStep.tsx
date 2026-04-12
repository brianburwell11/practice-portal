import { useLyricsEditorStore } from '../../store/lyricsEditorStore';

export function LyricsInputStep() {
  const rawText = useLyricsEditorStore((s) => s.rawText);
  const setRawText = useLyricsEditorStore((s) => s.setRawText);

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      <p className="text-xs text-gray-500">
        One lyric line per row. Type <code className="text-gray-400">[Instrumental]</code> on its own line to mark an instrumental break.
      </p>
      <textarea
        className="flex-1 min-h-0 w-full bg-gray-800 border border-gray-700 rounded-lg p-4 text-sm text-gray-200 font-mono resize-none outline-none focus:border-blue-500 placeholder-gray-600"
        placeholder="Paste or type lyrics here, one line per row..."
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}

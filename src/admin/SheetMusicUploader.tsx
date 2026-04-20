import { useRef, useState } from 'react';
import { SHEET_MUSIC_ACCEPT, canonicalSheetMusicName } from './utils/sheetMusic';

interface Props {
  /** Filename already saved in config.sheetMusicUrl, if any. */
  currentUrl?: string;
  /** New file staged in this session, not yet uploaded. */
  pendingFile: File | null;
  /** Called when the user picks a valid file. */
  onSelect: (file: File) => void;
  /** Clears the staged-but-not-yet-saved file. */
  onDiscardPending: () => void;
  /** Marks the saved file for removal on next save. */
  onRemoveExisting: () => void;
  disabled?: boolean;
}

/**
 * Shared picker for MusicXML / MXL sheet-music uploads. Uploading is
 * done by the caller at save time; this component only manages the
 * pick / replace / discard / remove UI and extension validation.
 *
 * Styled to match the wizard + Edit Song stem rows (bg-gray-800 cards
 * with small filename + × remove). No colored pending indicator — the
 * wizard doesn't need one (everything is pending until Save), and Edit
 * Song already signals unsaved state via the Save button's dirty flag.
 */
export function SheetMusicUploader({
  currentUrl,
  pendingFile,
  onSelect,
  onDiscardPending,
  onRemoveExisting,
  disabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const openPicker = () => {
    setPickError(null);
    inputRef.current?.click();
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const canonical = canonicalSheetMusicName(file);
    if (!canonical) {
      setPickError(`Unsupported file type — pick a .musicxml, .xml, .mxl, or .mscz file.`);
      return;
    }
    setPickError(null);
    onSelect(file);
  };

  const displayName = pendingFile?.name ?? currentUrl;
  const hasFile = !!displayName;
  const removeHandler = pendingFile ? onDiscardPending : onRemoveExisting;

  return (
    <div className="space-y-2">
      {hasFile ? (
        <div className="flex items-center gap-3 bg-gray-800 rounded-lg p-3">
          <span className="text-sm text-gray-400">Sheet music</span>
          <span className="flex-1 text-xs text-gray-500 truncate">{displayName}</span>
          <button
            type="button"
            onClick={openPicker}
            disabled={disabled}
            className="text-xs text-gray-400 hover:text-gray-200 px-1 disabled:opacity-50"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => { removeHandler(); setPickError(null); }}
            disabled={disabled}
            className="text-gray-500 hover:text-red-400 text-sm px-1 disabled:opacity-50"
            title="Remove"
          >
            &times;
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openPicker}
            disabled={disabled}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
          >
            + Sheet music
          </button>
          <span className="text-xs text-gray-500">.musicxml, .xml, .mxl, .mscz</span>
        </div>
      )}

      {pickError && <p className="text-xs text-red-400">{pickError}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={SHEET_MUSIC_ACCEPT}
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
}

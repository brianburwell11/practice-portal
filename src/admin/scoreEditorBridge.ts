/**
 * What the score editor page (score-editor/main.tsx) puts on its window for
 * the app's ScoreEditorPanel. The two are on the same origin, so the panel
 * calls these directly through the iframe's contentWindow.
 *
 * Kept free of imports: the editor page (built separately) imports it too.
 */
export interface ScoreEditorBridge {
  /** A score is open and laid out. */
  hasScore(): boolean;
  /** The open score has changes that aren't saved. */
  isModified(): boolean;
  /** Why the score couldn't be opened, if it couldn't. */
  loadError(): string | null;
  /** The open score as a MuseScore file. */
  saveMscz(fileName: string): Uint8Array;
  /** The score was saved to the song: clear its modified state. */
  markSaved(): void;
  /** Set by the panel: File > Save or Ctrl/Cmd+S in the editor. */
  onSaveRequest?: () => void;
  /** Set by the panel: the score or the editor's state changed. */
  onChange?: () => void;
}

declare global {
  interface Window {
    scoreEditor?: ScoreEditorBridge;
  }
}

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
  /**
   * Opens a score file the panel has in hand (an upload, or MusicXML made
   * from the beat map). `name`'s extension says what it is: `.mscz`,
   * `.mxl`, `.musicxml` or `.xml`. Anything but a MuseScore file opens as a
   * new, unsaved score.
   */
  openScore(name: string, data: ArrayBuffer): Promise<void>;
  /** The open score as a MuseScore file. */
  saveMscz(fileName: string): Uint8Array;
  /** The score was saved to the song: clear its modified state. */
  markSaved(): void;
  /** Set by the panel: File > Save or Ctrl/Cmd+S in the editor. */
  onSaveRequest?: () => void;
  /** Set by the panel: the score or the editor's state changed. */
  onChange?: () => void;
  /** Stops the editor's playback, if it's playing. */
  stopPlayback(): void;
  /**
   * Set by the panel: the song's recording, which the editor's playback
   * plays instead of the notation (score-editor/songAudioPlayer.ts) unless
   * its toolbar is set to Notation. Null or unset: the editor plays the
   * notation with its own sounds.
   */
  songAudio?: SongAudioHost | null;
}

/** The app's audio engine, as the score editor's playback drives it. Times are seconds of audio. */
export interface SongAudioHost {
  /** Each played measure's tap times: its downbeat, then its beats (the song's tapMap). */
  beatTimes: number[][];
  /** Resolves once the audio is actually playing. */
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  /** The position being heard now. */
  position(): number;
  isPlaying(): boolean;
  setLoop(from: number, to: number): void;
  clearLoop(): void;
}

declare global {
  interface Window {
    scoreEditor?: ScoreEditorBridge;
  }
}

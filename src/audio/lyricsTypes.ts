export interface LyricsLine {
  text: string;
  time: number | null;
  instrumental?: boolean;
}

export interface LyricsData {
  lines: LyricsLine[];
}

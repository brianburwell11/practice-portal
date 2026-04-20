export interface SavedSheetMusicSongState {
  hiddenPartIds: string[];
}

function storageKey(songId: string): string {
  return `sheetMusic:${songId}`;
}

export function saveSheetMusicSongState(
  songId: string,
  state: SavedSheetMusicSongState,
): void {
  try {
    localStorage.setItem(storageKey(songId), JSON.stringify(state));
  } catch {
    // Quota exceeded or unavailable — silently ignore
  }
}

export function loadSheetMusicSongState(
  songId: string,
): SavedSheetMusicSongState | null {
  try {
    const raw = localStorage.getItem(storageKey(songId));
    if (!raw) return null;
    return JSON.parse(raw) as SavedSheetMusicSongState;
  } catch {
    return null;
  }
}

interface SavedStemState {
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  stereo: boolean;
}

interface SavedGroupState {
  volume: number;
  muted: boolean;
  soloed: boolean;
}

export interface SavedMixerState {
  masterVolume: number;
  stems: Record<string, SavedStemState>;
  groups: Record<string, SavedGroupState>;
}

function storageKey(songId: string): string {
  return `mixer:${songId}`;
}

export function saveMixerState(songId: string, state: SavedMixerState): void {
  try {
    localStorage.setItem(storageKey(songId), JSON.stringify(state));
  } catch {
    // Quota exceeded or unavailable — silently ignore
  }
}

export function loadMixerState(songId: string): SavedMixerState | null {
  try {
    const raw = localStorage.getItem(storageKey(songId));
    if (!raw) return null;
    return JSON.parse(raw) as SavedMixerState;
  } catch {
    return null;
  }
}

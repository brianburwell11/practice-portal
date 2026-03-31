import type { TapMapEntry } from './types';

/** Parse a Transcribe! timestamp like "0:00:04.717792" or "1:30.500000" to seconds. */
function parseTimestamp(ts: string): number {
  // Format: H:MM:SS.ffffff or M:SS.ffffff
  const parts = ts.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10);
    const seconds = parseFloat(parts[1]);
    return minutes * 60 + seconds;
  }
  return parseFloat(ts);
}

/** Parse a Transcribe! .xsc file and extract tap map entries. */
export function parseXscFile(content: string): TapMapEntry[] {
  const entries: TapMapEntry[] = [];
  const lines = content.split('\n');

  let inMarkers = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'SectionStart,Markers') {
      inMarkers = true;
      continue;
    }
    if (trimmed === 'SectionEnd,Markers') {
      break;
    }
    if (!inMarkers) continue;

    // Skip non-marker lines (like "Howmany,188")
    const parts = trimmed.split(',');
    const markerType = parts[0];

    if (markerType === 'S' || markerType === 'M' || markerType === 'B') {
      // Format: TYPE,-1,1,LABEL,0,TIMESTAMP
      const label = parts[3] || undefined;
      const timestamp = parts[5];
      if (!timestamp) continue;

      const time = parseTimestamp(timestamp);

      let type: TapMapEntry['type'];
      if (markerType === 'S') {
        type = 'section';
      } else if (markerType === 'M') {
        type = 'measure';
      } else {
        type = 'beat';
      }

      const entry: TapMapEntry = { time, type };
      if (type === 'section' && label) {
        entry.label = label;
      }
      entries.push(entry);
    }
  }

  return entries.sort((a, b) => a.time - b.time);
}

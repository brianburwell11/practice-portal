/**
 * MuseScore CLI discovery and `.mscz` → `.mxl` conversion.
 */
import fs from 'node:fs';
import { run } from './run';

/**
 * Resolve the MuseScore CLI binary. Honors `MUSESCORE_BIN` env override
 * first, then tries `mscore` on `PATH`, then the default macOS install
 * location. Returns `null` if none of those are runnable, so callers
 * can surface a clear error rather than spawn-failing with ENOENT.
 */
export async function resolveMscoreBin(): Promise<string | null> {
  const candidates: string[] = [];
  if (process.env.MUSESCORE_BIN) candidates.push(process.env.MUSESCORE_BIN);
  candidates.push('mscore');
  candidates.push('/Applications/MuseScore 4.app/Contents/MacOS/mscore');
  for (const bin of candidates) {
    try {
      // `-v` prints version and exits 0 when the binary is reachable.
      if ((await run(bin, ['-v'], { timeoutMs: 30_000 })).code === 0) return bin;
    } catch {
      // Not there — try the next candidate.
    }
  }
  return null;
}

export const MSCORE_MISSING_MESSAGE =
  'MuseScore CLI not found. Install MuseScore 4 (macOS: https://musescore.org), '
  + 'set MUSESCORE_BIN to the binary path, or symlink `mscore` onto PATH.';

/**
 * Run `mscore -o <out> <in>`. Throws only when no output file appears:
 * MuseScore 4.7.x writes the MXL successfully but then crashes during Qt
 * teardown (exit 134, "mutex lock failed"), so a non-zero exit alone
 * doesn't mean the conversion failed.
 */
export async function convertScore(mscoreBin: string, inputPath: string, outputPath: string): Promise<void> {
  let detail = '';
  try {
    // MuseScore spins up Qt; give it enough time for a reasonably large
    // score. 60 s is plenty for the 93-measure Wiggle sample (~1 s in
    // practice).
    const proc = await run(mscoreBin, ['-o', outputPath, inputPath], { timeoutMs: 60_000 });
    if (proc.code !== 0) detail = `: exit ${proc.code}`;
  } catch (err) {
    detail = `: ${(err as Error).message}`;
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error(`MuseScore produced no output file${detail}`);
  }
}

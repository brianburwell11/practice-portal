// @vitest-environment node
/**
 * Normalizing a stem: a gain toward -16 LUFS, a limiter only for the peaks
 * that gain pushes over, and a gate only when there's a clear noise bed.
 * The ffmpeg checks run where ffmpeg is installed (not CI).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ffprobe, measureLoudness, normalizeFilters, planNormalize, transcodeToOpus } from './ffmpeg';

describe('planNormalize', () => {
  it('a quiet stem with headroom gets the full gain, no limiter', () => {
    const p = planNormalize({ integrated: -31, truePeak: -18, noiseFloor: -45 });
    expect(p.gainDb).toBeCloseTo(15);
    expect(p.limit).toBe(false);
    expect(p.gate).toBeNull();
  });

  it('a peaky stem is limited by at most 6 dB, and stops short of the target', () => {
    const p = planNormalize({ integrated: -29.3, truePeak: 0, noiseFloor: -50 });
    expect(p.gainDb).toBeCloseTo(4.5); // -1.5 - 0 + 6
    expect(p.limit).toBe(true);
  });

  it('a loud stem is turned down, with no limiter or gate', () => {
    const p = planNormalize({ integrated: -10, truePeak: -0.5, noiseFloor: -40 });
    expect(p.gainDb).toBeCloseTo(-6);
    expect(p.limit).toBe(false);
    expect(p.gate).toBeNull();
  });

  it('gates a clear noise bed, holding it back by as much as the gain', () => {
    const p = planNormalize({ integrated: -28.2, truePeak: -6.7, noiseFloor: -65 });
    expect(p.gainDb).toBeCloseTo(11.2); // -1.5 + 6.7 + 6: peak-limited
    expect(p.gate).not.toBeNull();
    expect(p.gate!.thresholdDb).toBeCloseTo(-55); // floor + 10, under loudness - 15
    expect(p.gate!.rangeDb).toBeCloseTo(p.gainDb);
  });

  it('leaves drum-mic bleed alone: the floor is too close to the playing', () => {
    expect(planNormalize({ integrated: -33.8, truePeak: -7, noiseFloor: -44 }).gate).toBeNull();
    expect(planNormalize({ integrated: -27.9, truePeak: -4.1, noiseFloor: -38 }).gate).toBeNull();
  });

  it('no gate when the stem isn’t being turned up', () => {
    expect(planNormalize({ integrated: -14, truePeak: -1, noiseFloor: -70 }).gate).toBeNull();
  });

  it('caps the gate’s range at 24 dB', () => {
    const p = planNormalize({ integrated: -50, truePeak: -30, noiseFloor: -90 });
    expect(p.gainDb).toBeCloseTo(34);
    expect(p.gate!.rangeDb).toBe(24);
  });

  it('leaves silence and unmeasurable files alone', () => {
    for (const l of [
      { integrated: -70, truePeak: -Infinity, noiseFloor: null },
      { integrated: -Infinity, truePeak: -Infinity, noiseFloor: null },
      { integrated: NaN, truePeak: -3, noiseFloor: null },
    ]) {
      expect(normalizeFilters(planNormalize(l))).toEqual([]);
    }
  });

  it('filters run gate, then gain, then limiter', () => {
    const f = normalizeFilters({ gainDb: 8, limit: true, gate: { thresholdDb: -55, rangeDb: 8 } });
    expect(f.map((x) => x.split('=')[0])).toEqual(['agate', 'volume', 'alimiter']);
    expect(f[2]).toContain('level=false');
  });
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!hasFfmpeg)('normalizing real audio with ffmpeg', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'normalize-test-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const ebur = (file: string) => {
    const r = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
    const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
    return { I: +s.match(/I:\s+(-?[\d.]+) LUFS/)![1], TP: +s.match(/Peak:\s+(-?[\d.]+) dBFS/)![1] };
  };
  /** Loudness of a stretch of the file, LUFS. */
  const loudnessOf = (file: string, from: number, seconds: number) => {
    const r = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-nostats', '-ss', String(from), '-t', String(seconds), '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
    const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
    return +s.match(/I:\s+(-?[\d.]+) LUFS/)![1];
  };
  const make = (name: string, filter: string) => {
    const f = path.join(dir, name);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', filter, '-c:a', 'pcm_s24le', f]);
    return f;
  };

  it('a quiet tone reaches -16 LUFS, peaks under the ceiling', async () => {
    const src = make('quiet.wav', 'sine=frequency=330:duration=8:sample_rate=48000,volume=-28dB');
    const out = path.join(dir, 'quiet.opus');
    const loudness = await measureLoudness(src);
    await transcodeToOpus(src, out, await ffprobe(src), loudness, true);
    const r = ebur(out);
    expect(r.I).toBeGreaterThan(-17);
    expect(r.I).toBeLessThan(-15);
    expect(r.TP).toBeLessThan(-1);
  }, 30_000);

  it('notes over a hiss: the notes come up, the hiss between them doesn’t', async () => {
    // 2 s of playing, 2 s of hiss only, 2 s of playing, 2 s of hiss.
    const src = make('hiss.wav',
      "aevalsrc=exprs='if(lt(mod(t\\,4)\\,2)\\,0.05*sin(2*PI*440*t)\\,0)':s=48000:d=8[s];anoisesrc=d=8:c=pink:r=48000:a=0.003[n];[s][n]amix=inputs=2:normalize=0");
    const out = path.join(dir, 'hiss.opus');
    const loudness = await measureLoudness(src);
    const plan = planNormalize(loudness);
    expect(plan.gate).not.toBeNull();
    await transcodeToOpus(src, out, await ffprobe(src), loudness, true);
    const notesBefore = loudnessOf(src, 0.5, 1);
    const notesAfter = loudnessOf(out, 0.5, 1);
    const hissBefore = loudnessOf(src, 2.8, 1);
    const hissAfter = loudnessOf(out, 2.8, 1);
    expect(notesAfter - notesBefore).toBeGreaterThan(plan.gainDb - 1);
    // The hiss ends up about where it was, not turned up with the notes.
    expect(hissAfter - hissBefore).toBeLessThan(2);
  }, 30_000);
});

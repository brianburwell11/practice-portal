import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scoreBytesToXml } from '../utils/safeUnzip';
import { parseMusicXML, unfold } from './unfoldRepeats';

/** The sample scores the docs site uses (exported from MuseScore). */
function sample(name: string): string {
  // Relative to the project root (vitest's working directory).
  const bytes = readFileSync(resolve('docs/public/xml-sample', name));
  return scoreBytesToXml(new Uint8Array(bytes));
}

describe('unfold on real MuseScore exports', () => {
  it('plays straight through a score without repeats', () => {
    const structure = parseMusicXML(sample('Wiggle.mxl'));
    const order = unfold(structure).map((s) => s.srcIndex);
    expect(order).toEqual(structure.measures.map((_, i) => i));
  });

  it('takes repeats, voltas and D.S. al Coda', () => {
    // roadmap-test: |: 2 3 :| ... |: 5 6[1. :| 7[2. ... segno 9, To Coda 10,
    // D.S. al Coda at 12, coda 13 (0-based indices below).
    const order = unfold(parseMusicXML(sample('roadmap-test.mxl'))).map((s) => s.srcIndex);
    expect(order).toEqual([0, 1, 2, 1, 2, 3, 4, 5, 4, 6, 7, 8, 9, 10, 11, 8, 9, 12, 13]);
  });
});

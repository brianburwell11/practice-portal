import { describe, expect, it } from 'vitest';
import { MSCZ_FILENAME, SCORE_FILENAME, songConfigSchema } from './schema';

const { sheetMusicUrl, sheetMusicMsczUrl, sheetMusicModified } = songConfigSchema.shape;

describe('sheetMusicUrl', () => {
  it('keeps a bare score filename', () => {
    for (const name of ['score.mxl', 'wiggle-sooza.mxl', 'My_Song.v2.musicxml', 'a.xml', 'b.mscz']) {
      expect(sheetMusicUrl.parse(name)).toBe(name);
    }
  });

  it('drops anything that could point the player elsewhere', () => {
    for (const bad of [
      '//evil.example/x.mxl',
      'https://evil.example/x.mxl',
      'http://evil.example/x.mxl',
      '/x.mxl',
      '../x.mxl',
      'a/b.mxl',
      'javascript:alert(1)',
      'score.mxl?x=1',
      'score.pdf',
      '',
    ]) {
      expect(sheetMusicUrl.parse(bad), bad).toBeUndefined();
    }
  });

  it('drops a non-string instead of failing the whole song', () => {
    expect(sheetMusicUrl.parse(42)).toBeUndefined();
    expect(sheetMusicUrl.parse(undefined)).toBeUndefined();
  });
});

describe('sheetMusicMsczUrl', () => {
  it('keeps only a bare .mscz filename', () => {
    expect(sheetMusicMsczUrl.parse('coco.mscz')).toBe('coco.mscz');
    expect(sheetMusicMsczUrl.parse('coco.mxl')).toBeUndefined();
    expect(sheetMusicMsczUrl.parse('//evil.example/coco.mscz')).toBeUndefined();
  });
});

describe('sheetMusicModified', () => {
  it('keeps a YYYY-MM-DD date', () => {
    expect(sheetMusicModified.parse('2026-11-02')).toBe('2026-11-02');
    expect(sheetMusicModified.parse('Nov 2 2026')).toBeUndefined();
    expect(sheetMusicModified.parse('2026-11-02T00:00:00Z')).toBeUndefined();
  });
});

describe('filename patterns', () => {
  it('match what the upload handlers write', () => {
    expect(SCORE_FILENAME.test('wiggle-sooza.mxl')).toBe(true);
    expect(MSCZ_FILENAME.test('wiggle-sooza.mscz')).toBe(true);
    expect(SCORE_FILENAME.test('.mxl')).toBe(false);
    expect(SCORE_FILENAME.test(`${'a'.repeat(121)}.mxl`)).toBe(false);
  });
});

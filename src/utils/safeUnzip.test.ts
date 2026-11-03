import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ZIP_LIMITS, extractEntries, isZip, scoreBytesToXml, UnsafeArchiveError, type ZipLimits } from './safeUnzip';

const XML = '<score-partwise version="3.1"><part-list/></score-partwise>';
const CONTAINER = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="song/score.musicxml"/></rootfiles></container>';
/** Small limits, so the hostile archives stay quick to build. */
const SMALL: ZipLimits = { maxEntries: 16, maxEntryBytes: 1024 * 1024, maxArchiveBytes: 8 * 1024 * 1024 };

/** Overwrites the uncompressed size the central directory claims for the first entry. */
function lieAboutSize(zip: Uint8Array, claimed: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = out.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      view.setUint32(view.getUint32(i + 16, true) + 24, claimed, true);
      return out;
    }
  }
  throw new Error('no zip directory');
}

describe('scoreBytesToXml', () => {
  it('reads the score named by META-INF/container.xml', () => {
    const mxl = zipSync({ 'META-INF/container.xml': strToU8(CONTAINER), 'song/score.musicxml': strToU8(XML) });
    expect(isZip(mxl)).toBe(true);
    expect(scoreBytesToXml(mxl)).toBe(XML);
  });

  it('falls back to the first XML file without a container', () => {
    expect(scoreBytesToXml(zipSync({ 'score.xml': strToU8(XML) }))).toBe(XML);
  });

  it('passes plain MusicXML through', () => {
    expect(scoreBytesToXml(strToU8(XML))).toBe(XML);
  });

  it('refuses a zip bomb before inflating it', () => {
    const bomb = zipSync({ 'score.xml': new Uint8Array(16 * 1024 * 1024) }, { level: 9 });
    expect(bomb.length).toBeLessThan(SMALL.maxEntryBytes);
    expect(() => scoreBytesToXml(bomb, SMALL)).toThrow(UnsafeArchiveError);
  });

  it('stops inflating at the limit when the header lies about the size', () => {
    const bomb = zipSync({ 'score.xml': new Uint8Array(16 * 1024 * 1024) }, { level: 9 });
    expect(() => scoreBytesToXml(lieAboutSize(bomb, 1000), SMALL)).toThrow(/too large/);
  });

  it('refuses archives with too many entries', () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 100; i++) many[`f${i}.xml`] = strToU8('x');
    expect(() => scoreBytesToXml(zipSync(many), SMALL)).toThrow(/too many entries/);
  });

  it('refuses a truncated archive', () => {
    const mxl = zipSync({ 'score.xml': strToU8(XML) });
    expect(() => scoreBytesToXml(mxl.subarray(0, mxl.length - 30))).toThrow(UnsafeArchiveError);
  });

  it('refuses an archive with no score in it', () => {
    expect(() => scoreBytesToXml(zipSync({ 'a.txt': strToU8('hi') }))).toThrow(/No score/);
  });

  it('refuses plain XML over the size limit', () => {
    expect(() => scoreBytesToXml(new Uint8Array(SMALL.maxEntryBytes + 1).fill(32), SMALL)).toThrow(/too large/);
  });

  it('has sane defaults', () => {
    expect(DEFAULT_ZIP_LIMITS.maxEntries).toBeGreaterThan(8);
    expect(DEFAULT_ZIP_LIMITS.maxEntryBytes).toBeLessThanOrEqual(DEFAULT_ZIP_LIMITS.maxArchiveBytes);
  });
});

describe('extractEntries', () => {
  it('inflates only the entries asked for', () => {
    const zip = zipSync({ 'a.mscx': strToU8('<museScore/>'), 'Thumbnails/thumbnail.png': new Uint8Array(10), 'score_style.mss': strToU8('<style/>') });
    const out = extractEntries(zip, (n) => !n.includes('/'), 1024);
    expect([...out.keys()].sort()).toEqual(['a.mscx', 'score_style.mss']);
  });

  it('caps the total of everything inflated', () => {
    const zip = zipSync({ 'a.mscx': new Uint8Array(600), 'b.mscx': new Uint8Array(600) });
    expect(() => extractEntries(zip, () => true, 1000)).toThrow(/too large/);
  });
});

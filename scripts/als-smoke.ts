/**
 * Parse an Ableton Live Set and print what the importer would do with it:
 * timing, tracks, render segments, skipped effects and warnings. No audio
 * is decoded, so this runs anywhere.
 *
 *   npm run smoke:als -- "path/to/Song Project/Song.als"
 *
 * Exits non-zero if any planned segment is malformed (negative offsets,
 * non-finite times, zero rates).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { parseAlsDocument } from '../src/admin/ableton/alsParser';
import { TempoMap, planClip } from '../src/admin/ableton/timeline';
import { buildTiming } from '../src/admin/ableton/buildTiming';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run smoke:als -- <file.als>');
  process.exit(2);
}

const xml = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
const doc = new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
const set = parseAlsDocument(doc);
const tempo = new TempoMap(set.tempo);

let failures = 0;
const fmt = (n: number) => n.toFixed(3);

console.log(`${set.creator}`);
console.log(`tempo: ${set.tempo.map((p) => `${p.value} bpm @${p.beat}`).join(', ')}`);
console.log(`meter: ${set.timeSignatures.map((t) => `${t.numerator}/${t.denominator} @${t.beat}`).join(', ')}`);
console.log(`locators: ${set.locators.map((l) => `"${l.name}" @${l.beat} (${fmt(tempo.beatToSec(l.beat))}s)`).join(', ')}`);
if (set.masterDevices.length) console.log(`master effects (skipped): ${set.masterDevices.join(', ')}`);

const groups = new Map(set.tracks.filter((t) => t.kind === 'group').map((t) => [t.id, t]));
let endBeat = 0;

for (const track of set.tracks) {
  const group = track.groupId ? groups.get(track.groupId) : undefined;
  const flags = [
    track.kind,
    group ? `in ${group.name}` : '',
    track.muted ? 'muted' : '',
    `vol ${fmt(track.volume)}`,
    track.pan ? `pan ${fmt(track.pan)}` : '',
    track.volumeAutomation.length ? `vol automation ${track.volumeAutomation.length} pts` : '',
    track.devices.length ? `effects: ${track.devices.join(', ')}` : '',
  ].filter(Boolean);
  console.log(`\n${track.name}  [${flags.join(' | ')}]`);
  for (const clip of track.clips) {
    const plan = planClip(clip, tempo);
    endBeat = Math.max(endBeat, clip.end);
    console.log(
      `  clip "${clip.name}" ${fmt(plan.startSec)}s-${fmt(plan.endSec)}s gain ${fmt(clip.gain)}` +
        ` ${clip.isWarped ? 'warped' : 'unwarped'}${clip.loopOn ? ' looped' : ''}${clip.disabled ? ' DISABLED' : ''}` +
        ` fades ${fmt(plan.fadeInSec)}/${fmt(plan.fadeOutSec)}s  <- ${clip.file.relativePath || clip.file.path}`,
    );
    for (const s of plan.segments) {
      const bad = !Number.isFinite(s.when + s.offset + s.duration + s.rate) || s.offset < -1e-6 || s.rate <= 0 || s.duration <= 0;
      if (bad) failures++;
      console.log(`    seg when ${fmt(s.when)} offset ${fmt(s.offset)} dur ${fmt(s.duration)} rate ${s.rate.toFixed(5)}${bad ? '  <-- BAD' : ''}`);
    }
    for (const w of plan.warnings) console.log(`    ! ${w}`);
  }
}

const timing = buildTiming(set, endBeat);
const counts = { section: 0, measure: 0, beat: 0 };
for (const e of timing.tapMap) counts[e.type]++;
console.log(`\nsong end: beat ${fmt(endBeat)} = ${fmt(tempo.beatToSec(endBeat))}s`);
console.log(`tempoMap: ${JSON.stringify(timing.tempoMap)}`);
console.log(`timeSignatureMap: ${JSON.stringify(timing.timeSignatureMap)}`);
console.log(`tapMap: ${counts.section} sections, ${counts.measure} measures, ${counts.beat} beats`);
console.log(`  first entries: ${JSON.stringify(timing.tapMap.slice(0, 6))}`);

if (failures) {
  console.error(`\n${failures} malformed segment(s)`);
  process.exit(1);
}

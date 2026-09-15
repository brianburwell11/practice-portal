/**
 * Prove the container's media toolchain works, through the real code paths.
 *
 *   FIXTURES_DIR=docs/public/xml-sample npx tsx scripts/mscz-smoke.ts   # on your Mac
 *   docker run --rm -v "$PWD/docs/public/xml-sample:/fixtures:ro" \
 *     -e FIXTURES_DIR=/fixtures practice-portal-api npx tsx scripts/mscz-smoke.ts
 *
 * This deliberately calls resolveMscoreBin() and convertScore() rather than
 * shelling out to `mscore` directly: the thing we need to know is whether the
 * *server's* code works in the image, including the `-v` probe (which must
 * exit 0) and the tolerate-crash-on-exit logic.
 *
 * The .mxl comparison is structural, not byte-for-byte. MXL is a zip, and zips
 * embed timestamps; MuseScore also stamps its own version into the MusicXML.
 * Measure and note counts are the part that must not drift between platforms.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { resolveMscoreBin, convertScore, MSCORE_MISSING_MESSAGE } from '../server/core/media/musescore';
import { ffprobe, measureLoudness, transcodeToOpus } from '../server/core/media/ffmpeg';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`ok    ${label}`);
  } else {
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

const fixtures = process.env.FIXTURES_DIR ?? 'docs/public/xml-sample';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mscz-smoke-'));

/** Pull the score XML out of an .mxl (a zip with a META-INF container). */
function scoreXml(mxlPath: string): string {
  const names = execSync(`unzip -Z1 "${mxlPath}"`, { encoding: 'utf-8' })
    .split('\n').map((n) => n.trim()).filter(Boolean);
  const entry = names.find((n) => !n.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(n));
  if (!entry) throw new Error(`no score XML inside ${mxlPath} (entries: ${names.join(', ')})`);
  return execSync(`unzip -p "${mxlPath}" "${entry}"`, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
}

const countTags = (xml: string, tag: string) =>
  (xml.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;

console.log(`--- environment`);
console.log(`      fixtures: ${fixtures}`);
console.log(`      platform: ${process.platform}/${process.arch}  node ${process.versions.node}`);

// ------------------------------------------------------------------ ffmpeg

console.log('\n--- ffmpeg');
let ffmpegVersion = '';
try {
  ffmpegVersion = execFileSync('ffmpeg', ['-version'], { encoding: 'utf-8' }).split('\n')[0];
} catch { /* reported by the check below */ }
check('ffmpeg is on PATH', ffmpegVersion.startsWith('ffmpeg version'), ffmpegVersion || 'not runnable');
console.log(`      ${ffmpegVersion}`);

// A synthetic stem, so this works with no audio committed to the repo.
const wav = path.join(tmp, 'tone.wav');
execSync(`ffmpeg -y -v quiet -f lavfi -i "sine=frequency=440:duration=5:sample_rate=48000" -ac 2 "${wav}"`);
check('generated a 5s stereo test stem', fs.existsSync(wav));

const probe = ffprobe(wav);
check('ffprobe reads the stem', probe.channels === 2 && probe.sampleRate === 48000,
  `codec=${probe.codec} ch=${probe.channels} sr=${probe.sampleRate}`);

const loudness = measureLoudness(wav);
check('two-pass loudnorm pass 1 measures', typeof loudness.input_i === 'string' && !Number.isNaN(parseFloat(loudness.input_i)),
  `input_i=${loudness.input_i}`);

const opus = path.join(tmp, 'tone.opus');
transcodeToOpus(wav, opus, probe, loudness, true);
check('transcoded to Opus', fs.existsSync(opus) && fs.statSync(opus).size > 0);
const opusProbe = ffprobe(opus);
check('output is 48 kHz Opus', opusProbe.codec === 'opus' && opusProbe.sampleRate === 48000,
  `codec=${opusProbe.codec} sr=${opusProbe.sampleRate}`);

// --------------------------------------------------------------- MuseScore

console.log('\n--- MuseScore');
const bin = resolveMscoreBin();
check('resolveMscoreBin() found a runnable binary', bin !== null, MSCORE_MISSING_MESSAGE);
console.log(`      MUSESCORE_BIN=${process.env.MUSESCORE_BIN ?? '(unset)'}  resolved=${bin ?? 'null'}`);

const input = path.join(fixtures, 'Wiggle - SOOZA.mscz');
const reference = path.join(fixtures, 'Wiggle.mxl');
check('input fixture present', fs.existsSync(input), input);

if (bin && fs.existsSync(input)) {
  const output = path.join(tmp, 'Wiggle.mxl');
  const started = Date.now();
  let convertError: unknown = null;
  try {
    convertScore(bin, input, output);
  } catch (err) {
    convertError = err;
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  check('convertScore() produced an .mxl', convertError === null && fs.existsSync(output),
    convertError ? String(convertError) : '');
  console.log(`      took ${seconds}s`);

  if (fs.existsSync(output)) {
    check('output is non-trivial', fs.statSync(output).size > 1000, `${fs.statSync(output).size} bytes`);

    const got = scoreXml(output);
    check('output contains parseable MusicXML', got.includes('<score-partwise'));

    if (fs.existsSync(reference)) {
      const want = scoreXml(reference);
      const gotM = countTags(got, 'measure');
      const wantM = countTags(want, 'measure');
      const gotN = countTags(got, 'note');
      const wantN = countTags(want, 'note');
      check('measure count matches the macOS reference', gotM === wantM, `container=${gotM} reference=${wantM}`);
      check('note count matches the macOS reference', gotN === wantN, `container=${gotN} reference=${wantN}`);
      const gotParts = countTags(got, 'score-part');
      const wantParts = countTags(want, 'score-part');
      check('part count matches the macOS reference', gotParts === wantParts, `container=${gotParts} reference=${wantParts}`);
    } else {
      console.log(`skip  comparison against macOS reference — ${reference} not found`);
    }
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n===== ${failures} failure(s) =====`);
process.exit(failures ? 1 : 0);

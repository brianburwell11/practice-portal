/**
 * MusicXML repeat / jump unfolder.
 *
 * Ported from the research widget at
 * `docs/src/components/react/sheet/RepeatUnfolder.tsx` — see
 * `docs/src/content/docs/sheet-music-repeats.mdx` for the full spec.
 *
 * Pure logic only — no React, no JSZip. Callers that need to unzip an
 * MXL archive should do that themselves and pass the inner `<score-partwise>`
 * XML text to `parseMusicXML`.
 *
 * The public API is two functions:
 *
 *   - `parseMusicXML(xmlText)` — returns the `MusicXMLStructure`, a per-
 *     written-measure record of every repeat/volta/jump marker we detected.
 *   - `unfold(structure)` — runs the state machine and returns the
 *     unfolded playback order as `{ srcIndex, pass }` tuples.
 *
 * The algorithm priorities (per-measure) match the widget and the research
 * post: Fine → To-Coda → D.C./D.S. → backward-repeat → volta gate.
 */

/** Per-written-measure metadata extracted from the MusicXML. */
export interface MeasureStructure {
  /** 0-based index into the `measures` array. */
  index: number;
  /** The `number` attribute from the XML (usually "1", "2" …, can be "0"). */
  number: string;
  /** `|:` at the left barline. */
  forwardRepeat: boolean;
  /** `:|` at the right barline. */
  backwardRepeat: boolean;
  /** Volta numbers that apply to this measure. Empty = no volta. */
  voltaNumbers: number[];
  /** Volta boundary flags on this measure. */
  voltaStart: boolean;
  voltaStop: boolean;
  /** `<segno/>` present anywhere in the measure. */
  hasSegno: boolean;
  /** `<coda/>` destination present anywhere in the measure. */
  hasCoda: boolean;
  /** `<sound tocoda="..."/>` — the "To Coda" jump trigger (attribute value). */
  toCodaTarget: string | null;
  /** `<sound dacapo="yes"/>` or `<words>D.C.…</words>` */
  dacapo: boolean;
  dacapoAlFine: boolean;
  dacapoAlCoda: boolean;
  /** `<sound dalsegno="X"/>` target, or null if none. */
  dalsegno: string | null;
  dalsegnoAlFine: boolean;
  dalsegnoAlCoda: boolean;
  /** `<sound fine="yes"/>` or `<words>Fine</words>`. */
  hasFine: boolean;
  /** Unclassified `<words>` text — kept for debugging. */
  rawWords: string[];
}

/** Structural output of `parseMusicXML`. */
export interface MusicXMLStructure {
  measures: MeasureStructure[];
}

/** One step in the unfolded playback order. */
export interface UnfoldedStep {
  /** Written-measure index (key into `measureXs`, `MusicXMLStructure.measures`). */
  srcIndex: number;
  /** Which traversal of the enclosing forward-repeat block this is, 1-based. */
  pass: number;
  /** Optional annotation describing why we jumped here (e.g. "D.S.", "Fine"). */
  cause?: string;
}

// ────────────────────────────── MusicXML parse ──────────────────────────────

/**
 * Parse a MusicXML text blob (the inner score XML, post-MXL-unzip) into a
 * structural description of every measure's repeat / volta / jump markers.
 *
 * Only the first `<part>` is inspected — bar-level structure is shared
 * across all parts in a partwise score, so this is sufficient.
 */
export function parseMusicXML(xmlText: string): MusicXMLStructure {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('MusicXML parse error');

  const part = doc.querySelector('part');
  if (!part) throw new Error('No <part> element found');
  const mEls = Array.from(part.querySelectorAll(':scope > measure'));

  const activeVolta: { numbers: number[] } = { numbers: [] };

  const measures = mEls.map((m, index) => {
    const info: MeasureStructure = {
      index,
      number: m.getAttribute('number') ?? String(index + 1),
      forwardRepeat: false,
      backwardRepeat: false,
      voltaNumbers: [],
      voltaStart: false,
      voltaStop: false,
      hasSegno: false,
      hasCoda: false,
      toCodaTarget: null,
      dacapo: false,
      dacapoAlFine: false,
      dacapoAlCoda: false,
      dalsegno: null,
      dalsegnoAlFine: false,
      dalsegnoAlCoda: false,
      hasFine: false,
      rawWords: [],
    };

    // Barlines: repeats + voltas
    const barlines = Array.from(m.querySelectorAll(':scope > barline'));
    for (const bl of barlines) {
      const repeat = bl.querySelector('repeat');
      if (repeat) {
        const dir = repeat.getAttribute('direction');
        if (dir === 'forward') info.forwardRepeat = true;
        if (dir === 'backward') info.backwardRepeat = true;
      }
      const ending = bl.querySelector('ending');
      if (ending) {
        const type = ending.getAttribute('type'); // start | stop | discontinue
        const numberAttr = ending.getAttribute('number') ?? '1';
        const nums = numberAttr
          .split(/[,\s]+/)
          .map((s) => parseInt(s, 10))
          .filter((n) => !Number.isNaN(n));
        if (type === 'start') {
          activeVolta.numbers = nums;
          info.voltaStart = true;
        } else if (type === 'stop' || type === 'discontinue') {
          info.voltaStop = true;
        }
      }
    }
    if (activeVolta.numbers.length) info.voltaNumbers = [...activeVolta.numbers];
    if (info.voltaStop) activeVolta.numbers = [];

    // Directions: segno / coda / words / sound
    const directions = Array.from(m.querySelectorAll(':scope > direction'));
    for (const dir of directions) {
      if (dir.querySelector('direction-type > segno')) info.hasSegno = true;
      if (dir.querySelector('direction-type > coda')) info.hasCoda = true;

      const wordsEls = Array.from(dir.querySelectorAll('direction-type > words'));
      for (const w of wordsEls) {
        const text = (w.textContent ?? '').trim();
        if (!text) continue;
        info.rawWords.push(text);
        const t = text.toLowerCase();
        if (/\bd\.?\s*c\.?\b/.test(t) || /da\s*capo/.test(t)) {
          info.dacapo = true;
          if (/al\s*fine/.test(t)) info.dacapoAlFine = true;
          if (/al\s*coda/.test(t)) info.dacapoAlCoda = true;
        }
        if (/\bd\.?\s*s\.?\b/.test(t) || /dal\s*segno/.test(t)) {
          info.dalsegno = info.dalsegno ?? 'segno';
          if (/al\s*fine/.test(t)) info.dalsegnoAlFine = true;
          if (/al\s*coda/.test(t)) info.dalsegnoAlCoda = true;
        }
        if (/^fine\b/.test(t)) info.hasFine = true;
      }

      const sound = dir.querySelector(':scope > sound');
      if (sound) {
        if (sound.getAttribute('dacapo') === 'yes') info.dacapo = true;
        const ds = sound.getAttribute('dalsegno');
        if (ds) info.dalsegno = ds;
        const tc = sound.getAttribute('tocoda');
        if (tc) info.toCodaTarget = tc;
        if (sound.getAttribute('fine') === 'yes') info.hasFine = true;
      }
    }

    // Measure-level <sound> (rare but permitted by spec).
    const measureSound = m.querySelector(':scope > sound');
    if (measureSound) {
      if (measureSound.getAttribute('dacapo') === 'yes') info.dacapo = true;
      const ds = measureSound.getAttribute('dalsegno');
      if (ds) info.dalsegno = ds;
      const tc = measureSound.getAttribute('tocoda');
      if (tc) info.toCodaTarget = tc;
      if (measureSound.getAttribute('fine') === 'yes') info.hasFine = true;
    }

    return info;
  });

  return { measures };
}

// ────────────────────────────── Unfold algorithm ────────────────────────────

/** Per-song knobs that bend the unfold algorithm away from the default
 *  spec behavior. Surfaced in the song config so admins can tune
 *  individual scores. */
export interface UnfoldOptions {
  /** When true, internal repeats (`|: :|`) and voltas are re-taken on
   *  the return pass after a D.C. / D.S. jump. Default is false —
   *  convention is that D.C./D.S. walks straight through. Uncommon but
   *  not unheard of in practice, so it's exposed per-song. */
  repeatAfterDcDs?: boolean;
}

/**
 * Run the state-machine unfolder on a parsed `MusicXMLStructure`, returning
 * the unfolded playback order as `{ srcIndex, pass }[]`.
 *
 * End-of-measure priority:
 *   1. To Coda — only active after a D.S./D.C. al Coda has fired.
 *   2. D.C. / D.S. — each fires at most once.
 *   3. Backward repeat — loop to matching forward repeat.
 *
 * Volta gate runs before the measure is visited (skip forward to a matching
 * volta if the current pass number isn't in the current measure's list).
 *
 * Fine is intentionally NOT honored. Per the MusicXML spec, Fine would
 * terminate the unfold after a D.C./D.S. jump, but in practice authors
 * often trim the score past the intended endpoint and leave the Fine
 * marker as decoration. Ignoring Fine and walking to the actual last
 * written measure gives a predictable result without requiring the
 * author to be exact about the interaction.
 */
export function unfold(
  structure: MusicXMLStructure,
  options: UnfoldOptions = {},
): UnfoldedStep[] {
  const measures = structure.measures;
  const steps: UnfoldedStep[] = [];
  if (measures.length === 0) return steps;

  const segnoIdx = measures.findIndex((m) => m.hasSegno);
  const codaIdx = measures.findIndex((m) => m.hasCoda);

  const passCount = new Map<number, number>();
  const backwardTaken = new Map<number, number>();
  const repeatPlays = 2;

  let dcTaken = false;
  let dsTaken = false;

  let i = 0;
  let safety = measures.length * 16;

  while (i < measures.length && safety-- > 0) {
    const m = measures[i];

    // Volta gate: if the current measure has active voltas, the current
    // pass number must match; otherwise skip forward to a matching volta
    // or past the volta block entirely.
    if (m.voltaNumbers.length > 0) {
      const forwardStart = findEnclosingForwardRepeat(measures, i);
      const pass = forwardStart !== null ? (passCount.get(forwardStart) ?? 1) : 1;
      if (!m.voltaNumbers.includes(pass)) {
        i = findMatchingVoltaOrExit(measures, i, pass);
        continue;
      }
    }

    const enclosingFwd = findEnclosingForwardRepeat(measures, i);
    const passForStep = enclosingFwd !== null ? (passCount.get(enclosingFwd) ?? 1) : 1;
    steps.push({ srcIndex: i, pass: passForStep });

    if (m.forwardRepeat && !passCount.has(i)) passCount.set(i, 1);

    // 1. To Coda — only after D.S./D.C. al Coda
    if (m.toCodaTarget && (dsTaken || dcTaken) && codaIdx >= 0) {
      steps[steps.length - 1].cause = 'to coda';
      i = codaIdx;
      continue;
    }

    // 2. D.C. / D.S. — fire at most once each. When
    // `options.repeatAfterDcDs` is set, clear the internal-repeat
    // state so backward repeats and volta gating fire fresh on the
    // return pass. `dcTaken` / `dsTaken` still stick so the jump
    // itself can't re-fire (that would loop forever).
    if (m.dacapo && !dcTaken) {
      dcTaken = true;
      if (options.repeatAfterDcDs) {
        backwardTaken.clear();
        passCount.clear();
      }
      steps[steps.length - 1].cause = m.dacapoAlFine
        ? 'D.C. al Fine'
        : m.dacapoAlCoda ? 'D.C. al Coda' : 'D.C.';
      i = 0;
      continue;
    }
    if (m.dalsegno && !dsTaken && segnoIdx >= 0) {
      dsTaken = true;
      if (options.repeatAfterDcDs) {
        backwardTaken.clear();
        passCount.clear();
      }
      steps[steps.length - 1].cause = m.dalsegnoAlFine
        ? 'D.S. al Fine'
        : m.dalsegnoAlCoda ? 'D.S. al Coda' : 'D.S.';
      i = segnoIdx;
      continue;
    }

    // 3. Backward repeat
    if (m.backwardRepeat) {
      const target = findBackwardRepeatTarget(measures, i);
      const prev = backwardTaken.get(i) ?? 0;
      if (prev + 1 < repeatPlays) {
        backwardTaken.set(i, prev + 1);
        passCount.set(target, (passCount.get(target) ?? 1) + 1);
        steps[steps.length - 1].cause = `repeat → m.${measures[target].number}`;
        i = target;
        continue;
      }
    }

    i++;
  }

  return steps;
}

function findEnclosingForwardRepeat(measures: MeasureStructure[], i: number): number | null {
  for (let j = i; j >= 0; j--) {
    if (measures[j].forwardRepeat) return j;
  }
  return null;
}

function findBackwardRepeatTarget(measures: MeasureStructure[], endIdx: number): number {
  for (let j = endIdx - 1; j >= 0; j--) {
    if (measures[j].forwardRepeat) return j;
  }
  return 0;
}

function findMatchingVoltaOrExit(
  measures: MeasureStructure[],
  start: number,
  pass: number,
): number {
  for (let j = start + 1; j < measures.length; j++) {
    const m = measures[j];
    if (m.voltaNumbers.length === 0) return j;
    if (m.voltaNumbers.includes(pass)) return j;
  }
  return measures.length;
}

import { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';

/**
 * RepeatUnfolder — fetches an MXL URL, unzips it, parses the MusicXML, detects
 * every repeat-flavored construct (repeats, voltas, D.C., D.S., segno, coda,
 * fine, "to coda"), and renders two strips:
 *
 *   1. "As notated" — one box per written measure, annotated with any markers
 *      found in that measure.
 *   2. "Unfolded"   — the linear playback order the audio engine sees, produced
 *      by a small jump-pointer state machine.
 *
 * Approximations / shortcuts intentionally taken:
 *
 *   - Voltas with more than two endings are handled generically (pass N plays
 *     the volta whose number list contains N), but the detection treats
 *     `number="1,2"` style lists correctly.
 *   - D.C. al Fine / D.S. al Fine stop at a `<sound fine="yes"/>` on the *second*
 *     traversal only. D.C. / D.S. without "al Fine" play to the end of the
 *     score (or to the coda jump if one exists).
 *   - "To coda" is treated as active only *after* a D.S. or D.C. has fired.
 *   - Nested forward repeats are detected but only the innermost loops; truly
 *     pathological overlapping constructs are punted on (marked with a warning
 *     in the UI). A complete solution would mirror MuseScore's `RepeatList`.
 *   - Pickup-bar numbering (measure 0) is preserved verbatim from the MXL's
 *     <measure number="..."> attribute rather than renumbered.
 */

interface Props {
  /** URL to an MXL (compressed MusicXML) file. */
  url?: string;
  /** Optional label for the header. */
  label?: string;
}

interface MeasureInfo {
  /** 0-based index into the measures array. */
  index: number;
  /** The `number` attribute from the MXL — usually "1", "2" … but can be "0" for pickup. */
  number: string;
  /** Forward repeat at the left barline — start of a `|:` block. */
  forwardRepeat: boolean;
  /** Backward repeat at the right barline — end of a `:|` block. */
  backwardRepeat: boolean;
  /** Volta numbers that apply to this measure. */
  voltaNumbers: number[];
  /** Volta boundary flags. */
  voltaStart: boolean;
  voltaStop: boolean;
  /** `<segno/>` in any direction. */
  hasSegno: boolean;
  /** `<coda/>` — the coda destination. */
  hasCoda: boolean;
  /** `<sound tocoda="..."/>` — the "To Coda" jump trigger. */
  toCodaTarget: string | null;
  /** `<sound dacapo="yes"/>` or `<words>D.C…</words>`. */
  dacapo: boolean;
  dacapoAlFine: boolean;
  dacapoAlCoda: boolean;
  /** `<sound dalsegno="X"/>` target or null. */
  dalsegno: string | null;
  dalsegnoAlFine: boolean;
  dalsegnoAlCoda: boolean;
  /** `<sound fine="yes"/>` or `<words>Fine</words>`. */
  hasFine: boolean;
  /** Extra `<words>` text we didn't specifically classify, for debugging display. */
  rawWords: string[];
}

interface UnfoldStep {
  srcIndex: number;
  pass: number;
  /** Annotation for why we jumped here (optional). */
  cause?: string;
}

// ────────────────────────────── MusicXML parse ──────────────────────────────

function parseMusicXML(xmlText: string): MeasureInfo[] {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('MusicXML parse error');

  // Partwise: pick the first <part>; that's enough to detect structure, all
  // parts share the same bar-level repeat/jump markings.
  const part = doc.querySelector('part');
  if (!part) throw new Error('No <part> element found');
  const mEls = Array.from(part.querySelectorAll(':scope > measure'));

  const activeVolta: { numbers: number[] } = { numbers: [] };

  return mEls.map((m, index) => {
    const info: MeasureInfo = {
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

    // Barlines: repeats + endings (voltas)
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

    // Directions: segno, coda, words, sound
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
          // heuristic target "segno" — overridden if sound@dalsegno is set
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
        // `<sound segno="X"/>` on a direction marks a segno target by name; we
        // already captured the visual segno via <segno/>.
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
}

// ────────────────────────────── Unfold algorithm ────────────────────────────

function unfold(measures: MeasureInfo[]): { steps: UnfoldStep[]; warnings: string[] } {
  const steps: UnfoldStep[] = [];
  const warnings: string[] = [];
  if (measures.length === 0) return { steps, warnings };

  const segnoIdx = measures.findIndex((m) => m.hasSegno);
  const codaIdx = measures.findIndex((m) => m.hasCoda);

  // Track pass count per forward-repeat start index.
  const passCount = new Map<number, number>();
  // Track which backward-repeat endpoints we've already taken — once per
  // forward-repeat-start we loop at most `repeatPlays` times.
  const backwardTaken = new Map<number, number>();
  const repeatPlays = 2; // standard |: :| plays section twice total

  // Jump-state flags — once D.C./D.S. fires we don't re-take it.
  let dcTaken = false;
  let dsTaken = false;
  // "Fine" is only obeyed on the second pass through the measure (the one
  // that followed a D.C./D.S.). Counted per-measure.
  const fineVisits = new Map<number, number>();

  let i = 0;
  let safety = measures.length * 16; // guardrail

  while (i < measures.length && safety-- > 0) {
    const m = measures[i];

    // Volta gate: if this measure carries a volta number and that number does
    // NOT include the current pass, skip forward to the next measure whose
    // volta matches — or past the volta block entirely.
    if (m.voltaNumbers.length > 0) {
      const forwardStart = findEnclosingForwardRepeat(measures, i);
      const pass = (forwardStart !== null ? passCount.get(forwardStart) ?? 1 : 1);
      if (!m.voltaNumbers.includes(pass)) {
        const jumpTo = findMatchingVoltaOrExit(measures, i, pass);
        i = jumpTo;
        continue;
      }
    }

    // Visit this measure.
    const passForStep =
      (findEnclosingForwardRepeat(measures, i) !== null
        ? passCount.get(findEnclosingForwardRepeat(measures, i) as number) ?? 1
        : 1);
    steps.push({ srcIndex: i, pass: passForStep });
    fineVisits.set(i, (fineVisits.get(i) ?? 0) + 1);

    // Note start-of-measure forward repeat — bump the pass counter the FIRST
    // time we enter, so the step recorded above shows pass 1, not 0.
    if (m.forwardRepeat) {
      if (!passCount.has(i)) passCount.set(i, 1);
    }

    // End-of-measure handlers, in spec priority:
    // 1. Fine — but only active after a D.C. / D.S. jump has fired.
    if (m.hasFine && (dcTaken || dsTaken)) {
      steps[steps.length - 1].cause = 'Fine';
      break;
    }

    // 2. "To Coda" — only active after a D.S./D.C. al Coda has fired.
    if (m.toCodaTarget && (dsTaken || dcTaken) && codaIdx >= 0) {
      steps[steps.length - 1].cause = 'to coda';
      i = codaIdx;
      continue;
    }

    // 3. D.C. / D.S. — fire once.
    if (m.dacapo && !dcTaken) {
      dcTaken = true;
      steps[steps.length - 1].cause = m.dacapoAlFine
        ? 'D.C. al Fine'
        : m.dacapoAlCoda ? 'D.C. al Coda' : 'D.C.';
      i = 0;
      continue;
    }
    if (m.dalsegno && !dsTaken && segnoIdx >= 0) {
      dsTaken = true;
      steps[steps.length - 1].cause = m.dalsegnoAlFine
        ? 'D.S. al Fine'
        : m.dalsegnoAlCoda ? 'D.S. al Coda' : 'D.S.';
      i = segnoIdx;
      continue;
    }

    // 4. Backward repeat — loop to matching forward repeat (or start of piece
    //    if no forward repeat is found).
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

  if (safety <= 0) warnings.push('Unfold loop hit safety cap — likely malformed jump structure.');
  return { steps, warnings };
}

function findEnclosingForwardRepeat(measures: MeasureInfo[], i: number): number | null {
  for (let j = i; j >= 0; j--) {
    if (measures[j].forwardRepeat) return j;
  }
  // If no forward repeat was seen, the implied start of piece acts as one.
  return null;
}

function findBackwardRepeatTarget(measures: MeasureInfo[], endIdx: number): number {
  for (let j = endIdx - 1; j >= 0; j--) {
    if (measures[j].forwardRepeat) return j;
  }
  return 0;
}

function findMatchingVoltaOrExit(measures: MeasureInfo[], start: number, pass: number): number {
  for (let j = start + 1; j < measures.length; j++) {
    const m = measures[j];
    if (m.voltaNumbers.length === 0) return j; // past the volta block
    if (m.voltaNumbers.includes(pass)) return j;
  }
  return measures.length;
}

// ──────────────────────────────────── UI ────────────────────────────────────

export function RepeatUnfolder({
  url = '/xml-sample/roadmap-test.mxl',
  label = 'roadmap-test.mxl',
}: Props) {
  const [measures, setMeasures] = useState<MeasureInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        setMeasures(null);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let xmlText: string;
        const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
        if (isZip) {
          const zip = await JSZip.loadAsync(buf);
          // Read META-INF/container.xml to find the root score file.
          const container = zip.file('META-INF/container.xml');
          let rootPath: string | null = null;
          if (container) {
            const containerText = await container.async('string');
            const doc = new DOMParser().parseFromString(containerText, 'application/xml');
            rootPath = doc.querySelector('rootfile')?.getAttribute('full-path') ?? null;
          }
          const scoreFile = (rootPath && zip.file(rootPath))
            || zip.file(/\.xml$/i)[0]
            || null;
          if (!scoreFile) throw new Error('No score XML inside MXL');
          xmlText = await scoreFile.async('string');
        } else {
          xmlText = new TextDecoder('utf-8').decode(bytes);
        }
        const parsed = parseMusicXML(xmlText);
        if (cancelled) return;
        setMeasures(parsed);
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const { steps, warnings } = useMemo(() => {
    if (!measures) return { steps: [] as UnfoldStep[], warnings: [] as string[] };
    return unfold(measures);
  }, [measures]);

  const visitsBySrc = useMemo(() => {
    const m = new Map<number, number>();
    steps.forEach((s) => m.set(s.srcIndex, (m.get(s.srcIndex) ?? 0) + 1));
    return m;
  }, [steps]);

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--bg-secondary)',
      padding: '0.8rem',
      margin: '1.5rem 0',
    }}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <strong style={{ color: 'var(--accent)' }}>RepeatUnfolder</strong>
        <code style={{ fontSize: '0.78em' }}>{url}</code>
        {measures && (
          <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '0.82em' }}>
            {measures.length} written measures → {steps.length} unfolded events
          </span>
        )}
      </div>

      {!measures && !error && <div style={{ padding: '0.4rem' }}>Loading & parsing…</div>}
      {error && <div style={{ padding: '0.4rem', color: '#f87171' }}>Error: {error}</div>}

      {measures && (
        <>
          <SectionTitle>Written (as notated)</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: '0.8rem' }}>
            {measures.map((m) => (
              <MeasureBox
                key={m.index}
                label={`m.${m.number}`}
                highlight={hover === m.index}
                accentKind={accentKindFor(m)}
                annotations={annotationsFor(m)}
                secondary={(visitsBySrc.get(m.index) ?? 0) > 1
                  ? `×${visitsBySrc.get(m.index)}`
                  : undefined}
                barLeft={m.forwardRepeat ? 'heavy' : 'normal'}
                barRight={m.backwardRepeat ? 'heavy' : 'normal'}
                onEnter={() => setHover(m.index)}
                onLeave={() => setHover(null)}
              />
            ))}
          </div>

          <SectionTitle>Unfolded playback order</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {steps.map((s, i) => {
              const m = measures[s.srcIndex];
              return (
                <MeasureBox
                  key={i}
                  label={`m.${m.number}`}
                  highlight={hover === s.srcIndex}
                  accentKind={accentKindFor(m)}
                  annotations={s.cause ? [s.cause] : []}
                  secondary={s.pass > 1 ? `pass ${s.pass}` : undefined}
                  barLeft={m.forwardRepeat ? 'heavy' : 'normal'}
                  barRight={m.backwardRepeat ? 'heavy' : 'normal'}
                  onEnter={() => setHover(s.srcIndex)}
                  onLeave={() => setHover(null)}
                />
              );
            })}
          </div>

          {warnings.length > 0 && (
            <div style={{ marginTop: '0.6rem', color: '#f59e0b', fontSize: '0.8em' }}>
              {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          <div style={{ marginTop: '0.8rem', fontSize: '0.76em', color: 'var(--text-secondary)' }}>
            Legend: <Tag color="#7B68EE">|: :| repeat barlines</Tag>{' '}
            <Tag color="#D4A843">segno 𝄋</Tag>{' '}
            <Tag color="#10b981">coda 𝄌 / To Coda</Tag>{' '}
            <Tag color="#f87171">D.C. / D.S. / Fine</Tag>{' '}
            <Tag color="#94a3b8">volta 1./2./3.</Tag>
          </div>
        </>
      )}
    </div>
  );
}

function accentKindFor(m: MeasureInfo): AccentKind {
  if (m.dacapo || m.dalsegno || m.hasFine) return 'jump';
  if (m.hasSegno) return 'segno';
  if (m.hasCoda || m.toCodaTarget) return 'coda';
  if (m.voltaNumbers.length > 0) return 'volta';
  if (m.forwardRepeat || m.backwardRepeat) return 'repeat';
  return 'none';
}

function annotationsFor(m: MeasureInfo): string[] {
  const out: string[] = [];
  if (m.forwardRepeat) out.push('|: start');
  if (m.backwardRepeat) out.push(':| end');
  if (m.voltaNumbers.length > 0) out.push(`volta ${m.voltaNumbers.join('/')}`);
  if (m.hasSegno) out.push('segno');
  if (m.hasCoda) out.push('coda dest.');
  if (m.toCodaTarget) out.push(`→ coda "${m.toCodaTarget}"`);
  if (m.dacapo) {
    out.push(m.dacapoAlFine ? 'D.C. al Fine' : m.dacapoAlCoda ? 'D.C. al Coda' : 'D.C.');
  }
  if (m.dalsegno) {
    out.push(m.dalsegnoAlFine ? 'D.S. al Fine' : m.dalsegnoAlCoda ? 'D.S. al Coda' : 'D.S.');
  }
  if (m.hasFine) out.push('Fine');
  return out;
}

type AccentKind = 'none' | 'repeat' | 'volta' | 'segno' | 'coda' | 'jump';

const ACCENT_COLORS: Record<AccentKind, string> = {
  none: 'var(--border)',
  repeat: '#7B68EE',
  volta: '#94a3b8',
  segno: '#D4A843',
  coda: '#10b981',
  jump: '#f87171',
};

function MeasureBox({
  label, highlight, accentKind, annotations, secondary, barLeft, barRight, onEnter, onLeave,
}: {
  label: string;
  highlight: boolean;
  accentKind: AccentKind;
  annotations: string[];
  secondary?: string;
  barLeft: 'normal' | 'heavy';
  barRight: 'normal' | 'heavy';
  onEnter: () => void;
  onLeave: () => void;
}) {
  const accent = ACCENT_COLORS[accentKind];
  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        padding: '0.35rem 0.45rem',
        minWidth: 74,
        textAlign: 'center',
        background: highlight ? 'var(--bg-elevated)' : 'var(--bg-primary)',
        border: `1px solid ${accent}`,
        borderLeft: barLeft === 'heavy' ? `4px double ${accent}` : `1px solid ${accent}`,
        borderRight: barRight === 'heavy' ? `4px double ${accent}` : `1px solid ${accent}`,
        borderRadius: 3,
        fontSize: '0.76em',
        color: 'var(--text-primary)',
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <div style={{ fontWeight: 600 }}>{label}</div>
      {annotations.map((a, i) => (
        <div key={i} style={{ color: accent, fontSize: '0.92em' }}>{a}</div>
      ))}
      {secondary && (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.92em' }}>{secondary}</div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.78em',
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: '0.3rem',
    }}>{children}</div>
  );
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      color,
      border: `1px solid ${color}`,
      padding: '0.05rem 0.4rem',
      borderRadius: 3,
      marginRight: '0.3rem',
    }}>{children}</span>
  );
}

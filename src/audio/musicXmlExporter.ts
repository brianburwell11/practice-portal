import type { TapMapEntry } from './types';
import { getSections } from './tapMapUtils';

interface ExportMeasure {
  /** Rehearsal mark label, if this measure is a section start. */
  rehearsalLabel?: string;
  /** Numerator of the time signature for this measure (denominator is fixed at 4). */
  beatsPerMeasure: number;
}

/**
 * Group tapMap entries into measures. Each `section` or `measure` entry
 * starts a new measure; `beat` entries between starts contribute to that
 * measure's beat count. If no measure-level entries exist, falls back to
 * one 4/4 measure per section so the score still renders meaningfully.
 */
function buildMeasures(tapMap: TapMapEntry[]): ExportMeasure[] {
  const measureStartIndices: number[] = [];
  for (let i = 0; i < tapMap.length; i++) {
    const t = tapMap[i].type;
    if (t === 'section' || t === 'measure') measureStartIndices.push(i);
  }

  if (measureStartIndices.length === 0) {
    return getSections(tapMap).map((s) => ({
      rehearsalLabel: s.label,
      beatsPerMeasure: 4,
    }));
  }

  const measures: ExportMeasure[] = [];
  for (let i = 0; i < measureStartIndices.length; i++) {
    const startIdx = measureStartIndices[i];
    const endIdx =
      i + 1 < measureStartIndices.length
        ? measureStartIndices[i + 1]
        : tapMap.length;
    const beatCount = endIdx - startIdx;
    const entry = tapMap[startIdx];
    measures.push({
      rehearsalLabel: entry.type === 'section' ? entry.label : undefined,
      beatsPerMeasure: beatCount >= 2 ? beatCount : 4,
    });
  }
  return measures;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderMeasure(
  m: ExportMeasure,
  number: number,
  prevBeats: number | null,
  endsWithDoubleBar: boolean,
): string {
  const lines: string[] = [];
  lines.push(`    <measure number="${number}">`);

  // Emit attributes on measure 1 (clef, key, divisions, time) and on any
  // subsequent measure where the time signature changes.
  const isFirst = number === 1;
  const timeChanged = prevBeats !== null && prevBeats !== m.beatsPerMeasure;
  if (isFirst || timeChanged) {
    lines.push('      <attributes>');
    if (isFirst) {
      lines.push('        <divisions>1</divisions>');
      lines.push('        <key><fifths>0</fifths></key>');
    }
    lines.push(
      `        <time><beats>${m.beatsPerMeasure}</beats><beat-type>4</beat-type></time>`,
    );
    if (isFirst) {
      lines.push('        <clef><sign>G</sign><line>2</line></clef>');
    }
    lines.push('      </attributes>');
  }

  if (m.rehearsalLabel) {
    lines.push('      <direction placement="above">');
    lines.push('        <direction-type>');
    lines.push(
      `          <rehearsal>${escapeXml(m.rehearsalLabel)}</rehearsal>`,
    );
    lines.push('        </direction-type>');
    lines.push('      </direction>');
  }

  // Whole-measure rest. Duration matches the time-signature numerator
  // since divisions=1 (quarter note = 1 division).
  lines.push('      <note>');
  lines.push('        <rest measure="yes"/>');
  lines.push(`        <duration>${m.beatsPerMeasure}</duration>`);
  lines.push('      </note>');

  if (endsWithDoubleBar) {
    lines.push('      <barline location="right">');
    lines.push('        <bar-style>light-light</bar-style>');
    lines.push('      </barline>');
  }

  lines.push('    </measure>');
  return lines.join('\n');
}

/**
 * Build the full text of a MusicXML 3.1 partwise score: a single blank
 * staff (treble clef, C major) with rehearsal marks placed at each
 * section boundary in `tapMap`.
 */
export function buildMusicXmlContent(
  tapMap: TapMapEntry[],
  opts: { title?: string } = {},
): string {
  const measures = buildMeasures(tapMap);
  const title = opts.title ?? '';

  const measureXml: string[] = [];
  let prevBeats: number | null = null;
  for (let i = 0; i < measures.length; i++) {
    // Close this measure with a double bar if the next measure starts a
    // new section — i.e. the rehearsal mark visually follows a divider.
    const nextIsSection =
      i + 1 < measures.length && measures[i + 1].rehearsalLabel !== undefined;
    measureXml.push(renderMeasure(measures[i], i + 1, prevBeats, nextIsSection));
    prevBeats = measures[i].beatsPerMeasure;
  }

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="3.1">',
    ...(title
      ? [
          '  <work>',
          `    <work-title>${escapeXml(title)}</work-title>`,
          '  </work>',
        ]
      : []),
    '  <part-list>',
    '    <score-part id="P1">',
    '      <part-name></part-name>',
    '    </score-part>',
    '  </part-list>',
    '  <part id="P1">',
    ...measureXml,
    '  </part>',
    '</score-partwise>',
    '',
  ].join('\n');
}

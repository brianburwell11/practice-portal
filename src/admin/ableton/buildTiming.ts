/**
 * Song timing from an Ableton set: tempo map, time signature map and a
 * tapMap of locator sections, measures and beats.
 *
 * Live counts tempo in quarter notes per minute, while the app's tempoMap
 * counts in the meter's beat unit (a 12/8 bar is 12 app beats; see
 * `generateBeatGrid`). The tempo map is converted to match. The tapMap is
 * in seconds and uses the felt beat instead: compound meters (6/8, 9/8,
 * 12/8) tap dotted quarters.
 */
import type { TapMapEntry, TempoMapEntry, TimeSignatureEntry } from '../../audio/types';
import type { AbletonSet, AlsTimeSignature } from './alsParser';
import { TempoMap } from './timeline';

export interface ImportedTiming {
  tempoMap: TempoMapEntry[];
  timeSignatureMap: TimeSignatureEntry[];
  tapMap: TapMapEntry[];
}

/** Quarter notes in one bar. */
function barQuarters(ts: AlsTimeSignature): number {
  return (ts.numerator * 4) / ts.denominator;
}

function isCompound(ts: AlsTimeSignature): boolean {
  return ts.denominator === 8 && ts.numerator > 3 && ts.numerator % 3 === 0;
}

/** Quarter notes in one tapped beat. */
function tapBeatQuarters(ts: AlsTimeSignature): number {
  return isCompound(ts) ? 1.5 : 4 / ts.denominator;
}

function meterAt(meters: AlsTimeSignature[], beat: number): AlsTimeSignature {
  let active = meters[0];
  for (const m of meters) if (m.beat <= beat + 1e-9) active = m;
  return active;
}

/** Live quarter-note beat to app beat (the meter's denominator unit). */
function quarterToAppBeat(meters: AlsTimeSignature[], quarter: number): number {
  let app = 0;
  for (let i = 0; i < meters.length; i++) {
    const from = meters[i].beat;
    const to = Math.min(meters[i + 1]?.beat ?? Infinity, quarter);
    if (to <= from) break;
    app += ((to - from) * meters[i].denominator) / 4;
  }
  return app;
}

/** Meter changes snapped to bar lines, starting at beat 0. */
function normalizedMeters(set: AbletonSet): AlsTimeSignature[] {
  const meters = [...set.timeSignatures].sort((a, b) => a.beat - b.beat);
  if (meters.length === 0 || meters[0].beat > 0) {
    meters.unshift({ beat: 0, numerator: meters[0]?.numerator ?? 4, denominator: meters[0]?.denominator ?? 4 });
  }
  return meters.filter((m, i) => i === 0 || m.beat !== meters[i - 1].beat);
}

export function buildTiming(set: AbletonSet, endBeat: number): ImportedTiming {
  const tempo = new TempoMap(set.tempo);
  const meters = normalizedMeters(set);

  // Tempo map: one entry at every tempo or meter change, and every quarter
  // through a ramp (the app's tempo map only steps).
  const changeBeats = new Set<number>([0, ...meters.map((m) => m.beat)]);
  for (const b of tempo.breakpoints) if (b < endBeat) changeBeats.add(b);
  for (let b = 0; b < endBeat; b++) if (tempo.isRampAt(b)) changeBeats.add(b);
  const tempoMap: TempoMapEntry[] = [];
  for (const q of [...changeBeats].sort((a, b) => a - b)) {
    const bpm = Math.round(tempo.bpmAt(q) * (meterAt(meters, q).denominator / 4) * 1000) / 1000;
    if (tempoMap.length > 0 && tempoMap[tempoMap.length - 1].bpm === bpm) continue;
    tempoMap.push({ beat: Math.round(quarterToAppBeat(meters, q) * 1000) / 1000, bpm });
  }

  const timeSignatureMap: TimeSignatureEntry[] = meters.map((m) => ({
    beat: Math.round(quarterToAppBeat(meters, m.beat) * 1000) / 1000,
    numerator: m.numerator,
    denominator: m.denominator,
  }));

  // TapMap: walk bar by bar, labelling bars that start on a locator as
  // sections. Locators that fall mid-bar still get their own section.
  const sec = (q: number) => Math.round(tempo.beatToSec(q) * 10000) / 10000;
  const locators = set.locators.filter((l) => l.beat < endBeat);
  const usedLocators = new Set<number>();
  const tapMap: TapMapEntry[] = [];
  for (let i = 0; i < meters.length; i++) {
    const meter = meters[i];
    const regionEnd = Math.min(meters[i + 1]?.beat ?? Infinity, endBeat);
    const bar = barQuarters(meter);
    const step = tapBeatQuarters(meter);
    for (let barStart = meter.beat; barStart < regionEnd - 1e-9; barStart += bar) {
      const locIdx = locators.findIndex((l) => Math.abs(l.beat - barStart) < 1e-6);
      if (locIdx >= 0) {
        usedLocators.add(locIdx);
        tapMap.push({ time: sec(barStart), type: 'section', label: locators[locIdx].name });
      } else {
        tapMap.push({ time: sec(barStart), type: 'measure' });
      }
      for (let b = barStart + step; b < Math.min(barStart + bar, regionEnd) - 1e-9; b += step) {
        tapMap.push({ time: sec(b), type: 'beat' });
      }
    }
  }
  locators.forEach((l, i) => {
    if (!usedLocators.has(i)) tapMap.push({ time: sec(l.beat), type: 'section', label: l.name });
  });
  tapMap.sort((a, b) => a.time - b.time);
  const sectionTimes = new Set(tapMap.filter((e) => e.type === 'section').map((e) => e.time));

  return {
    tempoMap,
    timeSignatureMap,
    tapMap: tapMap.filter((e) => e.type === 'section' || !sectionTimes.has(e.time)),
  };
}

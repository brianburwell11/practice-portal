import { describe, expect, it } from 'vitest';
import { parseChordSheet } from './chordSheet';

const sections = (text: string) => parseChordSheet(text).sections.map((s) => [s.name, s.chords.join(' ')]);

describe('parseChordSheet', () => {
  it('reads a plain list', () => {
    expect(sections('G Em7 | C, D/F#')).toEqual([[null, 'G Em7 C D/F#']]);
  });

  it('reads ChordPro: inline chords, section directives, comments, metadata', () => {
    const sheet = `{title: Morning Light}
{key: G}
# a comment line
{start_of_verse: Verse 1}
[G]Morning light across the [Em7]kitchen floor
[Cmaj7]Coffee's cold, I'm [D/F#]running late
{end_of_verse}
{soc}
[C]Hold on, [D]hold on
{eoc}
{c: Bridge}
[Bm7]Every little [Em7]thing`;
    expect(sections(sheet)).toEqual([
      ['Verse 1', 'G Em7 Cmaj7 D/F#'],
      ['Chorus', 'C D'],
      ['Bridge', 'Bm7 Em7'],
    ]);
  });

  it('reads ChordPro grids, counting a held chord once and expanding %', () => {
    const sheet = `{start_of_grid: Intro}
| G . . . | G . . . | C . D . | % |
{end_of_grid}`;
    expect(sections(sheet)).toEqual([['Intro', 'G C D C D']]);
  });

  it('reads an Ultimate Guitar sheet: chord lines over lyrics, headings, repeats', () => {
    const sheet = `Capo: 2
Tuning: E A D G B E

[Intro]
Am  F  C  G  x2

[Verse 1]
Am             F
Walking down the road again
C                  G
Counting cars along the way

[Chorus]
F        G        Am
Hold the line, hold the line

e|-----0-----|
B|---1---1---|`;
    expect(sections(sheet)).toEqual([
      ['Intro', 'Am F C G Am F C G'],
      ['Verse 1', 'Am F C G'],
      ['Chorus', 'F G Am'],
    ]);
  });

  it("strips Ultimate Guitar's [ch] and [tab] markup", () => {
    expect(sections('[Verse]\n[tab][ch]Am[/ch]   [ch]G[/ch][/tab]\nwords here')).toEqual([['Verse', 'Am G']]);
  });

  it('keeps lyrics that look like headings or chords as lyrics', () => {
    const sheet = `[Verse]
G          C
Bridge over the river tonight
Am I the only one awake
D
A day like any other`;
    expect(sections(sheet)).toEqual([['Verse', 'G C D']]);
  });

  it('reports bracketed names it does not know, keeping the rest', () => {
    const parsed = parseChordSheet('[G]one [Xq]two [C]three');
    expect(parsed.sections).toEqual([{ name: null, chords: ['G', 'C'] }]);
    expect(parsed.unknown).toEqual(['Xq']);
  });

  it('reports a stray chord-like token on a chord line', () => {
    const parsed = parseChordSheet('G  C7#13  D  Em');
    expect(parsed.sections[0].chords).toEqual(['G', 'D', 'Em']);
    expect(parsed.unknown).toEqual(['C7#13']);
  });

  it('accepts word headings like "Chorus:" and "Verse 2"', () => {
    expect(sections('Verse 2\nG D\nChorus:\nC G')).toEqual([['Verse 2', 'G D'], ['Chorus', 'C G']]);
  });

  it('returns nothing for a sheet with no chords', () => {
    expect(parseChordSheet('just some words\nand more words').sections).toEqual([]);
  });

  it("repeats a line marked x(4), as in an Ultimate Guitar intro", () => {
    const sheet = `[Intro]

E5 D5 C#5 C Em
D5 C#5 C Em  x(4)
B5
E5 Em`;
    expect(sections(sheet)).toEqual([
      ['Intro', 'E5 D5 C#5 C Em D5 C#5 C Em D5 C#5 C Em D5 C#5 C Em D5 C#5 C Em B5 E5 Em'],
    ]);
  });

  it.each(['x4', 'x(4)', '(x4)', '[x4]', '4x', '(4x)', '×4', '*4', 'x 4', 'x (4)'])('reads %s as four times', (marker) => {
    expect(sections(`Am G ${marker}`)).toEqual([[null, 'Am G Am G Am G Am G']]);
  });

  it('a marker on its own line repeats the chord line above', () => {
    expect(sections('[Verse]\nC F\nwords to sing\n(x3)\nG')).toEqual([['Verse', 'C F C F C F G']]);
  });
});

import { describe, expect, it } from 'vitest';
import { repairUnicode } from '../scripts/glyph-repair.mjs';
import { layoutPages, type TextRun } from '../src/documents/pdfLayout';
import { numberIslands } from '../src/documents/pdfText';

const ch = (...codes: number[]) => String.fromCharCode(...codes);

/** A font's ToUnicode table, as pdf.js exposes it. */
function font(entries: Record<number, string>) {
  const map = new Map(Object.entries(entries).map(([k, v]) => [Number(k), v]));
  return {
    toUnicode: {
      get: (code: number) => map.get(code),
      charCodeOf: (value: string) => {
        for (const [k, v] of map) if (v === value) return k;
        return -1;
      },
    },
  };
}

describe('repairUnicode (fonts whose ToUnicode table lies)', () => {
  // As found in a Word export: the eight harakat side by side, three of them mislabelled.
  const broken = font({
    0xe037: ch(0x64a), // ي
    0xe038: ' ', // fathatan, written as a space
    0xe039: ch(0x64c),
    0xe03a: ch(0x64d),
    0xe03b: ch(0x64e),
    0xe03c: ch(0x62d), // damma, written as ح
    0xe03d: ch(0x650),
    0xe03e: ' ', // shadda, written as a space
    0xe03f: ch(0x652),
    0xe07e: ch(0x62a, 0x62c), // تج
    0xe07f: ch(0x62a, 0x64f), // تح, written as تُ
    0xe080: ch(0x62a, 0x62e), // تخ
    0xe0b4: ch(0x62d), // the real ح
    0xe10e: ch(0x627, 0x644, 0x644), // ﷲ without its ه
  });
  const fix = (code: number) => repairUnicode(broken, code, broken.toUnicode.get(code)!);

  it('restores diacritics that the table calls a letter or a space', () => {
    expect(fix(0xe03c)).toBe(ch(0x64f));
    expect(fix(0xe03e)).toBe(ch(0x651));
    expect(fix(0xe038)).toBe(ch(0x64b));
  });

  it('restores the second letter of a ligature', () => {
    expect(fix(0xe07f)).toBe(ch(0x62a, 0x62d));
  });

  it('restores the ه of الله', () => {
    expect(fix(0xe10e)).toBe(ch(0x627, 0x644, 0x644, 0x647));
  });

  it('leaves correct entries alone', () => {
    for (const code of [0xe037, 0xe039, 0xe03b, 0xe03d, 0xe07e, 0xe0b4]) expect(fix(code)).toBe(broken.toUnicode.get(code));
  });

  it('never changes a font whose table is right', () => {
    const good = font({ 0x10: ch(0x64e), 0x11: ch(0x64f), 0x12: ch(0x650), 0x13: ch(0x651), 0x20: ' ', 0x30: ch(0x644, 0x645) });
    for (const code of [0x10, 0x11, 0x12, 0x13, 0x20, 0x30]) expect(repairUnicode(good, code, good.toUnicode.get(code)!)).toBe(good.toUnicode.get(code));
  });

  it("doesn't turn a glyph into a letter the font already has", () => {
    // A shadda placed between ى and ً: its neighbours say ي, but ي has its own glyph.
    const f = font({ 1: ch(0x649), 2: ch(0x651), 3: ch(0x64b), 4: ch(0x64a) });
    expect(repairUnicode(f, 2, ch(0x651))).toBe(ch(0x651));
  });

  it('reads the glyph after غ as the tatweel (fonts skip U+063B–063F)', () => {
    const f = font({ 1: ch(0x639), 2: ch(0x63a), 3: ' ', 4: ch(0x641) });
    expect(repairUnicode(f, 3, ' ')).toBe(ch(0x640));
  });
});

describe('Arabic lines in PDFs', () => {
  const run = (str: string, x: number, width: number, y = 700, eol = false): TextRun => ({ str, x, y, width, size: 10, eol });

  it('reads a line with more digits than letters right to left', () => {
    // Drawn one glyph at a time, left to right: "(2014 ةنس 35.7%) 43.5%" on the page.
    const { html } = layoutPages([
      {
        runs: [
          run('(', 224, 4),
          run('2014', 228, 25),
          run(ch(0x629), 257, 5),
          run(ch(0x646), 262, 3),
          run(ch(0x633), 265, 8),
          run('35.7%', 276, 32),
          run(')', 308, 4),
          run('43.5%', 315, 32, 700, true),
        ],
      },
    ]);
    expect(html).toContain(`43.5% (35.7% ${ch(0x633, 0x646, 0x629)} 2014)`);
  });

  it('turns a range of numbers around in Arabic text', () => {
    expect(numberIslands('56,000–54,000')).toEqual(['56,000', '–', '54,000']);
    expect(numberIslands('+2.4%')).toEqual(['+', '2.4%']);
    expect(numberIslands('1,050')).toEqual(['1,050']);
  });

  it('keeps the space before a ك whose stroke overhangs it', () => {
    const word = ch(0x633, 0x648, 0x627, 0x621); // سواء
    const next = ch(0x643, 0x627, 0x646); // كان
    // The gap is 2 units at size 20: under the Latin threshold, but a space in Arabic.
    const { html } = layoutPages([{ runs: [{ str: next, x: 45, y: 700, width: 148, size: 20, eol: false }, { str: word, x: 195, y: 700, width: 24, size: 20, eol: true }] }]);
    expect(html).toContain(`${word} ${next}`);
  });
});

describe('tables drawn with row lines only', () => {
  it('finds the columns where the row lines meet, and the header in filled cells', () => {
    const rows = [351, 319, 286, 253];
    const rules = rows.flatMap((y) => [
      { x0: 358, x1: 549, y0: y, y1: y, horizontal: true },
      { x0: 46, x1: 358, y0: y, y1: y, horizontal: true },
    ]);
    const header = [
      { x0: 358, x1: 549, y0: 351, y1: 384, filled: true, stroked: false, curved: false },
      { x0: 46, x1: 358, y0: 351, y1: 384, filled: true, stroked: false, curved: false },
    ];
    const runs: TextRun[] = [
      { str: 'Indicator', x: 450, y: 362, width: 40, size: 10, eol: true },
      { str: 'Value', x: 100, y: 362, width: 25, size: 10, eol: true },
      ...rows.slice(0, -1).flatMap((y, i) => [
        { str: `Row ${i + 1}`, x: 450, y: y - 20, width: 30, size: 10, eol: true },
        { str: `${(i + 1) * 10}%`, x: 100, y: y - 20, width: 20, size: 10, eol: true },
      ]),
    ];
    const { html } = layoutPages([{ runs, view: [0, 0, 612, 792], graphics: { rules, shapes: header, images: [], text: { visible: 1, invisible: 0 } } }]);
    expect(html).toContain('<table');
    // Left to right: the left column comes first.
    expect(html).toMatch(/Value[\s\S]*Indicator/);
    expect(html).toContain('<td>30%</td><td>Row 3</td>');
  });

  it('ignores fraction bars and other lines with gaps between them', () => {
    const rules = [700, 680, 660].flatMap((y) => [
      { x0: 100, x1: 140, y0: y, y1: y, horizontal: true },
      { x0: 150, x1: 190, y0: y, y1: y, horizontal: true },
    ]);
    const runs: TextRun[] = [690, 670].flatMap((y) => [
      { str: 'a', x: 115, y, width: 5, size: 10, eol: false },
      { str: 'b', x: 165, y, width: 5, size: 10, eol: true },
    ]);
    const { html } = layoutPages([{ runs, view: [0, 0, 612, 792], graphics: { rules, shapes: [], images: [], text: { visible: 1, invisible: 0 } } }]);
    expect(html).not.toContain('<table');
  });
});

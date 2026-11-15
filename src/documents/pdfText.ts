/**
 * PDF text runs → lines of text, with Arabic and other right-to-left scripts put back into
 * reading order and repaired. A PDF only says "draw these glyphs here"; this rebuilds what the
 * author typed.
 *
 * Lines keep a style per character (bold, italic, superscript, code), so emphasis survives the
 * reordering and repairs below.
 *
 * Pure functions with no pdf.js dependency, so they're unit-tested directly.
 */

export interface TextRun {
  str: string;
  /** Left edge and baseline, in PDF units (y grows upwards). */
  x: number;
  y: number;
  width: number;
  /** Font size (height of the text matrix). */
  size: number;
  /** pdf.js marks the last run of a line. */
  eol: boolean;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
}

/** Per-character style flags. */
export const BOLD = 1;
export const ITALIC = 2;
export const SUP = 4;
export const MONO = 8;

/** Text as code points, each with its style flags. */
export interface StyledText {
  chars: string[];
  flags: number[];
}

export interface Line {
  text: string;
  styled: StyledText;
  x: number;
  right: number;
  y: number;
  size: number;
  page: number;
  rtl: boolean;
  /** The runs it was built from, in reading order (used for lists, tables, leaders). */
  runs: TextRun[];
}

/* ------------------------------------------------------------------ characters */

export const isRtlChar = (c: number) => (c >= 0x0590 && c <= 0x08ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfefc);
export const isLtrChar = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || (c >= 0xc0 && c <= 0x24f) || (c >= 0x370 && c <= 0x52f);
const isLatinLetter = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f) || (c >= 0x370 && c <= 0x52f);
const isDigit = (c: number) => (c >= 0x30 && c <= 0x39) || (c >= 0x660 && c <= 0x669) || (c >= 0x6f0 && c <= 0x6f9);
const isSpace = (c: number) => c <= 32 || c === 0xa0 || (c >= 0x2000 && c <= 0x200b) || c === 0x202f || c === 0x3000;

export function strength(s: string): { rtl: number; ltr: number } {
  let rtl = 0;
  let ltr = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isRtlChar(c)) rtl++;
    else if (isLtrChar(c)) ltr++;
  }
  return { rtl, ltr };
}

/**
 * Letters that set a line's direction. Digits don't (they're weak in the Unicode bidi rules), so
 * "43.5% (35.7% سنة 2014)" is a right-to-left line even though most of its characters are digits.
 */
export function letterDirection(s: string): { rtl: number; ltr: number } {
  let rtl = 0;
  let ltr = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isDigit(c)) continue;
    if (isRtlChar(c)) rtl++;
    else if (isLatinLetter(c)) ltr++;
  }
  return { rtl, ltr };
}

/** Arabic diacritics (harakat, tanwin, shadda, superscript alef, Quranic marks). */
export const isMark = (c: number) => (c >= 0x064b && c <= 0x065f) || c === 0x0670 || (c >= 0x06d6 && c <= 0x06ed) || (c >= 0xfe70 && c <= 0xfe7e && c % 2 === 0);
const onlyMarks = (s: string) => s.trim().length > 0 && [...s].every((ch) => isMark(ch.charCodeAt(0)) || ch === ' ');
const SHADDA = 0x0651;

/** A letter (or mark) that a diacritic can sit on. */
const isArabicBase = (c: number) => (c >= 0x0620 && c <= 0x064a) || (c >= 0x066e && c <= 0x06d3) || c === 0x06d5 || isMark(c) || (c >= 0x06fa && c <= 0x06ff);
const TATWEEL = 0x0640;

/** ﷺ ﷻ ﷼ ﷽: whole phrases in one sign. Readers expect the sign, not four expanded words. */
const isWordLigature = (c: number) => c >= 0xfdfa && c <= 0xfdfd;

/**
 * Arabic presentation forms (ﻓ ﻼ ﮭ…) and Latin ligatures (ﬁ) → ordinary letters, so text can be
 * searched, highlighted and read aloud. Lam-alef ligatures expand to لا in logical order.
 */
export function normalizeForms(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += ((c >= 0xfb00 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) && !isWordLigature(c) ? ch.normalize('NFKC') : ch;
  }
  return out;
}

/* ------------------------------------------------------------------ styled text */

const styled = (chars: string[] = [], flags: number[] = []): StyledText => ({ chars, flags });

function push(t: StyledText, s: string, flag: number) {
  for (const ch of s) {
    t.chars.push(ch);
    t.flags.push(flag);
  }
}

export const plain = (t: StyledText) => t.chars.join('');

/** Collapse whitespace runs to one space, trim, drop tatweel (a stretching stroke, not a letter). */
function collapse(t: StyledText): StyledText {
  const out = styled();
  let space = false;
  t.chars.forEach((ch, i) => {
    const c = ch.charCodeAt(0);
    if (c === TATWEEL || c === 0xfeff || c === 0x200c || c === 0x200d) return;
    if (isSpace(c)) {
      space = out.chars.length > 0;
      return;
    }
    if (space) {
      out.chars.push(' ');
      // A space between two bold words is bold; otherwise plain.
      out.flags.push(out.flags[out.flags.length - 1]! & t.flags[i]!);
    }
    space = false;
    out.chars.push(ch);
    out.flags.push(t.flags[i]!);
  });
  return out;
}

/**
 * Marks that arrive in the wrong place: a mark after a space belongs to the letter before the
 * space ("نَزَّل َ" → "نَزَّلَ "). A mark with no letter before it is dropped rather than shown on
 * a bracket or a space.
 */
export function fixMarks(t: StyledText): StyledText {
  if (!t.chars.some((ch) => isMark(ch.charCodeAt(0)))) return t;
  const out = styled();
  t.chars.forEach((ch, i) => {
    if (!isMark(ch.charCodeAt(0))) {
      out.chars.push(ch);
      out.flags.push(t.flags[i]!);
      return;
    }
    let k = out.chars.length - 1;
    while (k >= 0 && out.chars[k] === ' ') k--;
    if (k < 0 || !isArabicBase(out.chars[k]!.charCodeAt(0))) return;
    out.chars.splice(k + 1, 0, ch);
    out.flags.splice(k + 1, 0, out.flags[k]!);
  });
  return out;
}

export const fixMarksText = (s: string) => plain(fixMarks(styled([...s], [...s].map(() => 0))));

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«', '‹': '›', '›': '‹' };

/**
 * Some producers (Chrome, Skia) report the glyph that was drawn: in right-to-left text an opening
 * bracket is drawn mirrored, so "(" comes out as ")". Flip brackets back, except inside
 * left-to-right stretches (a Latin phrase in an Arabic line keeps its brackets).
 */
export function mirrorBrackets(t: StyledText): StyledText {
  if (!t.chars.some((ch) => MIRROR[ch])) return t;
  const strong = t.chars.map((ch) => {
    const c = ch.charCodeAt(0);
    return isRtlChar(c) || isDigit(c) ? 'r' : isLatinLetter(c) ? 'l' : '';
  });
  const side = (i: number, step: number) => {
    for (let j = i + step; j >= 0 && j < t.chars.length; j += step) if (strong[j]) return strong[j];
    return 'r';
  };
  return styled(
    t.chars.map((ch, i) => (MIRROR[ch] && !(side(i, -1) === 'l' && side(i, 1) === 'l') ? MIRROR[ch]! : ch)),
    t.flags,
  );
}

export const mirrorBracketsText = (s: string) => plain(mirrorBrackets(styled([...s], [...s].map(() => 0))));

/**
 * Whether a document's right-to-left lines need their brackets mirrored. Producers differ, so
 * look at the evidence: in correct text an opening bracket comes before its closing one.
 */
export function bracketsReversed(texts: string[]): boolean {
  let normal = 0;
  let reversed = 0;
  for (const t of texts) {
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
    ] as const) {
      const a = t.indexOf(open);
      const b = t.indexOf(close);
      if (a === -1 || b === -1) continue;
      if (a < b) normal++;
      else reversed++;
    }
  }
  return reversed > normal;
}

/* ------------------------------------------------------------------ right-to-left lines */

const kindOf = (s: string) => {
  const k = letterDirection(s);
  if (k.rtl) return 'rtl';
  if (k.ltr) return 'ltr';
  return strength(s).ltr ? 'num' : 'neutral';
};

/**
 * A piece of digits and punctuation split into numbers and what separates them, as the Unicode
 * bidi rules see it: a % or currency sign belongs to its number, and so does a single , . / : + -
 * between two digits; anything else (a dash, a space, a bracket) stands between numbers. In Arabic
 * text the numbers of "56,000–54,000" are read right to left, so the piece must be turned around.
 */
export function numberIslands(s: string): string[] {
  const chars = [...s];
  const digit = (ch: string | undefined) => ch !== undefined && isDigit(ch.charCodeAt(0));
  const sign = (ch: string) => '%‰$€£#°'.includes(ch);
  const joiner = (ch: string) => ',./:+-'.includes(ch);
  const parts: string[] = [];
  let cur = '';
  let numeric: boolean | null = null;
  chars.forEach((ch, i) => {
    const inNumber = digit(ch) || sign(ch) || (joiner(ch) && digit(chars[i - 1]) && digit(chars[i + 1]));
    if (numeric !== null && inNumber !== numeric) {
      parts.push(cur);
      cur = '';
    }
    cur += ch;
    numeric = inNumber;
  });
  if (cur) parts.push(cur);
  return parts;
}

/**
 * Many PDFs store right-to-left lines in visual order: pieces from left to right. Reading order
 * is right to left, except runs of Latin words and numbers inside the line, which keep their order.
 * Pieces with only punctuation are in visual order too, so their characters are reversed.
 * As in the Unicode bidi rules, numbers join a left-to-right stretch only after a Latin word: in
 * Arabic text, "43.5% (35.7%" is two numbers with a bracket between them, read right to left.
 */
function logicalOrder(visual: TextRun[]): TextRun[] {
  const rev = [...visual].reverse();
  const kind = rev.map((r) => kindOf(r.str));
  const out: TextRun[] = [];
  let i = 0;
  while (i < rev.length) {
    if (kind[i] === 'num') {
      // A number joins the Latin words it runs into; between Arabic words it stands alone.
      let j = i;
      while (j + 1 < rev.length && (kind[j + 1] === 'neutral' || kind[j + 1] === 'num')) j++;
      if (kind[j + 1] !== 'ltr') {
        const r = rev[i]!;
        // Numbers keep their digits' order; what lies between them is in visual order, like any
        // punctuation piece, so its characters turn around too.
        const parts = numberIslands(r.str).map((part) => (isDigit(part.charCodeAt(0)) || isDigit(part.charCodeAt(part.length - 1)) ? part : [...part].reverse().join('')));
        out.push(parts.length > 1 ? { ...r, str: parts.reverse().join('') } : r);
        i++;
        continue;
      }
    }
    if (kind[i] !== 'ltr' && kind[i] !== 'num') {
      const r = rev[i]!;
      out.push(kind[i] === 'neutral' && r.str.length > 1 ? { ...r, str: [...r.str].reverse().join('') } : r);
      i++;
      continue;
    }
    // Longest stretch of LTR (and neutral between LTR) pieces: restore their left-to-right order.
    let j = i;
    let lastLtr = i;
    while (j + 1 < rev.length && kind[j + 1] !== 'rtl') {
      j++;
      if (kind[j] === 'ltr' || kind[j] === 'num') lastLtr = j;
    }
    out.push(...rev.slice(i, lastLtr + 1).reverse());
    i = lastLtr + 1;
  }
  return out;
}

/**
 * Groups of marks that sit on one letter: one vowel sign, optionally with a shadda. "َْ" is two
 * letters' worth (fatha + sukun); "ِّ" is one (kasra + shadda).
 */
function markGroups(s: string): string[] {
  const groups: string[] = [];
  let cur = '';
  let hasVowel = false;
  let hasShadda = false;
  for (const ch of s) {
    if (ch === ' ') continue;
    const shadda = ch.charCodeAt(0) === SHADDA;
    if (cur && ((shadda && hasShadda) || (!shadda && hasVowel))) {
      groups.push(cur);
      cur = '';
      hasVowel = hasShadda = false;
    }
    cur += ch;
    if (shadda) hasShadda = true;
    else hasVowel = true;
  }
  if (cur) groups.push(cur);
  return groups;
}

/**
 * PDFs often draw Arabic diacritics as separate pieces on top of their letter. Put each one back
 * after the letter it sits on.
 *
 * A mark's own width is usually zero, so its position alone is ambiguous at the boundary between
 * two letters. Producers are consistent, though: the mark is drawn right before its letter
 * (Chrome, Skia) or right after it (others). Each line votes on which neighbour, in drawing
 * order, the marks sit on, and each mark goes to that neighbour.
 */
function attachMarks(runs: TextRun[]): TextRun[] {
  if (!runs.some((r) => onlyMarks(r.str))) return runs;
  const copy = runs.map((r) => ({ ...r }));
  const isBase = (r: TextRun) => !onlyMarks(r.str) && r.str.trim() !== '';
  // The nearest letter piece in drawing order, skipping other marks and spaces.
  const neighbour = (i: number, step: 1 | -1) => {
    for (let j = i + step; j >= 0 && j < copy.length; j += step) if (isBase(copy[j]!)) return copy[j];
    return undefined;
  };
  const over = (m: TextRun, b: TextRun | undefined) => !!b && m.x >= b.x - 1.5 && m.x + m.width <= b.x + b.width + 1.5;

  let next = 0;
  let prev = 0;
  copy.forEach((r, i) => {
    if (!onlyMarks(r.str)) return;
    if (over(r, neighbour(i, 1))) next++;
    if (over(r, neighbour(i, -1))) prev++;
  });
  const step: 1 | -1 = next >= prev ? 1 : -1;

  copy.forEach((m, i) => {
    if (!onlyMarks(m.str)) return;
    let base = neighbour(i, step);
    if (!over(m, base)) {
      base = [neighbour(i, 1), neighbour(i, -1)].find((b) => over(m, b));
      // Last resort: the letter piece whose middle is closest.
      if (!base) {
        let best = Infinity;
        for (const r of copy) {
          if (!isBase(r)) continue;
          const d = Math.abs(r.x + r.width / 2 - m.x);
          if (d < best && d < r.width / 2 + m.size * 0.6) [best, base] = [d, r];
        }
      }
    }
    if (!base) return;
    const chars = [...base.str];
    // A right-to-left piece: its characters run from the right edge leftwards. Marks in one piece
    // are in visual order (left to right), so each next one sits on the letter before.
    const f = base.width > 0 ? (base.x + base.width - m.x) / base.width : 0;
    let at = Math.min(chars.length - 1, Math.max(0, Math.floor(f * chars.length)));
    const groups = markGroups(m.str.normalize('NFKC'));
    const inserts: [number, string][] = [];
    for (const g of groups) {
      // Don't put a mark on a space: move to the nearest letter.
      while (at > 0 && chars[at] === ' ') at--;
      inserts.push([at, g]);
      at = Math.max(0, at - 1);
    }
    // Insert from the end so earlier positions stay valid; marks on one letter keep their order.
    inserts.sort((a, b) => b[0] - a[0]);
    for (const [pos, g] of inserts) chars.splice(pos + 1, 0, g);
    base.str = chars.join('');
    m.str = ''; // spaces between words come from the gaps between pieces, not from here
  });
  return copy.filter((r) => r.str !== '');
}

const runFlags = (r: TextRun) => (r.bold ? BOLD : 0) | (r.italic ? ITALIC : 0) | (r.mono ? MONO : 0);

/** One line's runs → a Line. */
export function lineFromRuns(runs: TextRun[], page: number): Line | null {
  const total = runs.reduce(
    (acc, r) => {
      const s = letterDirection(r.str);
      return { rtl: acc.rtl + s.rtl, ltr: acc.ltr + s.ltr };
    },
    { rtl: 0, ltr: 0 },
  );
  const rtl = total.rtl > total.ltr;
  // pdf.js gives each piece in logical order, but the pieces themselves come in whatever order the
  // PDF drew them. Position is the truth: for right-to-left lines, read the pieces by position.
  // Pieces that are only a space are dropped there: some producers place them at odd positions
  // (inside the next word), and the gaps between pieces already say where words end.
  const ordered =
    rtl && runs.length > 1
      ? logicalOrder(
          attachMarks(runs)
            .filter((r) => r.str.trim() !== '')
            .sort((a, b) => a.x - b.x),
        )
      : runs;

  // Superscripts: small pieces raised above the line's baseline (footnote calls, exponents).
  const main = runs.reduce((a, r) => (r.str.trim().length > a.str.trim().length ? r : a), runs[0]!);
  const isSup = (r: TextRun) => r.size < main.size * 0.8 && r.y > main.y + main.size * 0.2 && r.str.trim().length <= 4;

  const t = styled();
  ordered.forEach((r, i) => {
    const prev = ordered[i - 1];
    if (prev) {
      // Distance between the two pieces, whichever side the next one is on.
      const gap = Math.min(Math.abs(r.x - (prev.x + prev.width)), Math.abs(prev.x - (r.x + r.width)));
      const last = t.chars[t.chars.length - 1];
      // Arabic letters like ك overhang the space before them, so right-to-left word gaps look narrower.
      if (gap > Math.max(prev.size, r.size) * (rtl ? 0.08 : 0.12) && last !== ' ' && !r.str.startsWith(' ')) push(t, ' ', runFlags(prev) & runFlags(r));
    }
    push(t, normalizeForms(r.str), runFlags(r) | (isSup(r) ? SUP : 0));
  });
  let text = collapse(t);
  if (rtl) text = collapse(fixMarks(text));
  if (!text.chars.length) return null;

  const body = runs.filter((r) => r.str.trim().length > 2 && !isSup(r));
  return {
    text: plain(text),
    styled: text,
    x: Math.min(...runs.map((r) => r.x)),
    right: Math.max(...runs.map((r) => r.x + r.width)),
    y: main.y,
    size: Math.max(...(body.length ? body : runs).map((r) => r.size)),
    page,
    rtl,
    runs: ordered,
  };
}

/** Runs → lines, for one page (or one table cell). */
export function toLines(runs: TextRun[], page: number): Line[] {
  const groups: TextRun[][] = [];
  let cur: TextRun[] = [];
  let y = 0;
  let size = 0;
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };
  for (const r of runs) {
    if (r.str) {
      // A new line when the baseline moves by more than half a line (superscripts stay).
      if (cur.length && Math.abs(r.y - y) > Math.max(size, r.size) * 0.6) flush();
      if (!cur.length) {
        y = r.y;
        size = r.size;
      }
      if (r.size >= size) y = r.y;
      size = Math.max(size, r.size);
      cur.push(r);
    }
    if (r.eol) flush();
  }
  flush();
  return groups.map((g) => lineFromRuns(g, page)).filter((l): l is Line => l !== null);
}

/* ------------------------------------------------------------------ document-wide letter repairs */

const isArabicLetter = (c: number) => (c >= 0x0620 && c <= 0x064a) || (c >= 0x066e && c <= 0x06d3);
/** Letters only Persian/Urdu use: پ چ ژ گ ک ہ ے ٹ ڈ ڑ ں */
const PERSIAN_ONLY = new Set([0x067e, 0x0686, 0x0698, 0x06af, 0x06a9, 0x06c1, 0x06d2, 0x0679, 0x0688, 0x0691, 0x06ba]);

/**
 * Fonts often map Arabic letters to look-alike Persian/Urdu code points: yeh (ي) to Farsi yeh
 * (ی), and heh (ه) to heh doachashmee (ھ), which look identical inside a word. PDFs then come
 * out with the wrong letters, and words like "ليست" or "هذا" can't be found. In documents that
 * aren't Persian/Urdu, restore ي mid-word, ى at the end of a word, and ه.
 *
 * Returns a function that repairs one text (code points in, code points out, same length), or
 * null when the document needs no repair.
 */
export function arabicLetterFixer(texts: string[]): ((chars: string[]) => string[]) | null {
  let persian = 0;
  let lookalikes = 0;
  for (const t of texts) {
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (PERSIAN_ONLY.has(c)) persian++;
      else if (c === 0x06cc || c === 0x06be) lookalikes++;
    }
  }
  if (!lookalikes || persian > 3) return null;
  const yeh = String.fromCharCode(0x064a);
  const maksura = String.fromCharCode(0x0649);
  const heh = String.fromCharCode(0x0647);
  return (chars) =>
    chars.map((ch, i) => {
      const c = ch.charCodeAt(0);
      if (c === 0x06be) return heh;
      if (c !== 0x06cc) return ch;
      // Skip diacritics to find the next real letter.
      let j = i + 1;
      while (j < chars.length && isMark(chars[j]!.charCodeAt(0))) j++;
      return j < chars.length && isArabicLetter(chars[j]!.charCodeAt(0)) ? yeh : maksura;
    });
}

/** Text-only form of arabicLetterFixer (kept for callers that have plain strings). */
export function fixArabicYeh(texts: string[]): string[] {
  const fix = arabicLetterFixer(texts);
  return fix ? texts.map((t) => fix([...t]).join('')) : texts;
}

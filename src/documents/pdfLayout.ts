/**
 * Rebuilds readable text from PDF text runs. A PDF only says "draw these glyphs here"; this
 * turns positioned runs back into lines, paragraphs and headings, drops running headers,
 * footers and page numbers, and re-joins words hyphenated across lines.
 *
 * Pure functions with no pdf.js dependency, so they're unit-tested directly.
 */
import { escapeHtml } from './detect';

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
}

export interface PageText {
  runs: TextRun[];
}

interface Line {
  text: string;
  x: number;
  right: number;
  y: number;
  size: number;
  page: number;
}

interface Block {
  tag: 'p' | 'h2' | 'h3';
  text: string;
  size: number;
  /** Pages that start inside this block (for page markers). */
  pageMarks: { page: number; at: number }[];
}

const SENTENCE_END = new Set(['.', '!', '?', ':', ';', '"', '”', '»', ')', '؟', '۔', '…', String.fromCharCode(0x3002)]);
const PAGE_NUMBER = /^[-–— ]*(page |p[.] ?|صفحة )?([0-9٠-٩]+|[ivxlcdm]+)( ?([/]|of|sur|de|من) ?[0-9٠-٩]+)?[-–— ]*$/i;

/** Collapse whitespace without regex escapes (see the project notes on escape pitfalls). */
function collapse(s: string): string {
  let out = '';
  let space = false;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c <= 32 || c === 0xa0 || (c >= 0x2000 && c <= 0x200a) || c === 0x3000) {
      space = out.length > 0;
      continue;
    }
    if (space) out += ' ';
    space = false;
    out += ch;
  }
  return out;
}

const isRtlChar = (c: number) => (c >= 0x0590 && c <= 0x08ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfefc);
const isLtrChar = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || (c >= 0xc0 && c <= 0x24f);

function strength(s: string): { rtl: number; ltr: number } {
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
 * Arabic presentation forms (ﻓ ﻼ ﮭ…) and Latin ligatures (ﬁ) → ordinary letters, so text can be
 * searched, highlighted and read aloud. Lam-alef ligatures expand to لا in logical order.
 */
export function normalizeForms(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += (c >= 0xfb00 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff) ? ch.normalize('NFKC') : ch;
  }
  return out;
}

/**
 * Many PDFs store right-to-left lines in visual order: pieces from left to right. Reading order
 * is right to left, except runs of Latin words and numbers inside the line, which keep their order.
 */
function logicalOrder(visual: TextRun[]): TextRun[] {
  const rev = [...visual].reverse();
  const kind = rev.map((r) => {
    const s = strength(r.str);
    return s.rtl ? 'rtl' : s.ltr ? 'ltr' : 'neutral';
  });
  const out: TextRun[] = [];
  let i = 0;
  while (i < rev.length) {
    if (kind[i] !== 'ltr') {
      out.push(rev[i]!);
      i++;
      continue;
    }
    // Longest stretch of LTR (and neutral between LTR) pieces: restore their left-to-right order.
    let j = i;
    let lastLtr = i;
    while (j + 1 < rev.length && kind[j + 1] !== 'rtl') {
      j++;
      if (kind[j] === 'ltr') lastLtr = j;
    }
    out.push(...rev.slice(i, lastLtr + 1).reverse());
    i = lastLtr + 1;
  }
  return out;
}

/** Arabic diacritics (harakat, tanwin, shadda, superscript alef, Quranic marks). */
const isMark = (c: number) => (c >= 0x064b && c <= 0x065f) || c === 0x0670 || (c >= 0x06d6 && c <= 0x06ed) || (c >= 0xfe70 && c <= 0xfe7e && c % 2 === 0);
const onlyMarks = (s: string) => s.length > 0 && [...s].every((ch) => isMark(ch.charCodeAt(0)) || ch === ' ');

/**
 * PDFs often draw Arabic diacritics as separate pieces on top of their letter. Put each one back
 * after the letter it sits on (found by position), instead of letting it float between words.
 */
function attachMarks(runs: TextRun[]): TextRun[] {
  const marks = runs.filter((r) => onlyMarks(r.str));
  if (!marks.length) return runs;
  const bases = runs.filter((r) => !onlyMarks(r.str)).map((r) => ({ ...r }));
  for (const m of marks) {
    const cx = m.x + m.width / 2;
    let best: TextRun | undefined;
    let bestDist = Infinity;
    for (const b of bases) {
      const dist = cx < b.x ? b.x - cx : cx > b.x + b.width ? cx - (b.x + b.width) : 0;
      if (dist < bestDist) [best, bestDist] = [b, dist];
    }
    if (!best) continue;
    const chars = [...best.str];
    // Right-to-left piece: characters run from its right edge leftwards.
    const f = best.width > 0 ? (best.x + best.width - cx) / best.width : 0;
    const at = Math.min(chars.length - 1, Math.max(0, Math.floor(f * chars.length)));
    chars.splice(at + 1, 0, m.str.trim().normalize('NFKC'));
    best.str = chars.join('');
  }
  return bases;
}

function lineFromRuns(runs: TextRun[], page: number): Line | null {
  const total = runs.reduce(
    (acc, r) => {
      const s = strength(r.str);
      return { rtl: acc.rtl + s.rtl, ltr: acc.ltr + s.ltr };
    },
    { rtl: 0, ltr: 0 },
  );
  const rtl = total.rtl > total.ltr;
  // pdf.js gives each piece in logical order, but the pieces themselves come in whatever order the
  // PDF drew them. Position is the truth: for right-to-left lines, read the pieces by position.
  const ordered = rtl && runs.length > 1 ? logicalOrder(attachMarks(runs).sort((a, b) => a.x - b.x)) : runs;

  let text = '';
  ordered.forEach((r, i) => {
    const prev = ordered[i - 1];
    if (prev) {
      // Distance between the two pieces, whichever side the next one is on.
      const gap = Math.min(Math.abs(r.x - (prev.x + prev.width)), Math.abs(prev.x - (r.x + r.width)));
      if (gap > Math.max(prev.size, r.size) * 0.12 && !text.endsWith(' ') && !r.str.startsWith(' ')) text += ' ';
    }
    text += r.str;
  });
  text = collapse(normalizeForms(text));
  if (!text) return null;

  const body = runs.filter((r) => r.str.trim().length > 2);
  return {
    text,
    x: Math.min(...runs.map((r) => r.x)),
    right: Math.max(...runs.map((r) => r.x + r.width)),
    y: runs[0]!.y,
    size: Math.max(...(body.length ? body : runs).map((r) => r.size)),
    page,
  };
}

/** Runs → lines, for one page. */
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
      if (cur.length && Math.abs(r.y - y) > Math.max(size, r.size) * 0.6) flush();
      if (!cur.length) {
        y = r.y;
        size = r.size;
      }
      size = Math.max(size, r.size);
      cur.push(r);
    }
    if (r.eol) flush();
  }
  flush();
  return groups.map((g) => lineFromRuns(g, page)).filter((l): l is Line => l !== null);
}

const norm = (s: string) => s.toLowerCase().replace(/[0-9٠-٩]+/g, '#');

/** Remove running headers/footers (repeated on many pages) and bare page numbers. */
export function stripFurniture(pages: Line[][]): Line[][] {
  // Headers and footers are the lines nearest the top and bottom of the page, by position (PDFs
  // often draw them last). The outermost line always qualifies; the next one in only if it's set
  // smaller than the body text, as running heads are, so body lines that happen to repeat survive.
  const body = bodySize(pages.flat());
  const edge = (lines: Line[]) => {
    const byY = [...lines].sort((a, b) => b.y - a.y);
    const out = new Set<Line>([byY[0]!, byY[byY.length - 1]!].filter(Boolean));
    if (lines.length > 8) {
      for (const l of [byY[1], byY[byY.length - 2]]) if (l && l.size < body * 0.95) out.add(l);
    }
    return [...out];
  };
  const counts = new Map<string, number>();
  for (const lines of pages) {
    for (const t of new Set(edge(lines).map((l) => norm(l.text)))) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const threshold = Math.max(3, pages.length * 0.4);
  return pages.map((lines) => {
    const edges = new Set(edge(lines));
    return lines.filter((l) => {
      if (!edges.has(l)) return true;
      if (PAGE_NUMBER.test(l.text)) return false;
      return pages.length < 4 || (counts.get(norm(l.text)) ?? 0) < threshold || l.text.length > 160;
    });
  });
}

function percentile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * q)]!;
}

/** The size used by most of the text (weighted by characters). */
function bodySize(lines: Line[]): number {
  const weight = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    weight.set(k, (weight.get(k) ?? 0) + l.text.length);
  }
  let best = 0;
  let bestW = -1;
  for (const [k, w] of weight) if (w > bestW) [best, bestW] = [k, w];
  return best || 12;
}

const endsSentence = (s: string) => SENTENCE_END.has(s.trimEnd().slice(-1));
const isLower = (ch: string | undefined) => !!ch && ch.toLowerCase() === ch && ch.toUpperCase() !== ch;

function joinLines(a: string, b: string): string {
  // "infor-" + "mation" → "information" (only when the next line continues in lower case)
  const last = a.slice(-1);
  if ((last === '-' || last === String.fromCharCode(0xad)) && /[A-Za-zÀ-ɏ]$/.test(a.slice(0, -1)) && isLower(b[0])) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

/** Lines of all pages → blocks (paragraphs and headings). */
export function toBlocks(pages: Line[][]): Block[] {
  const all = pages.flat();
  const body = bodySize(all);
  const blocks: Block[] = [];
  let prev: Line | null = null;

  pages.forEach((lines, p) => {
    const gaps: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const dy = lines[i - 1]!.y - lines[i]!.y;
      const bothBody = [lines[i - 1]!, lines[i]!].every((l) => Math.abs(l.size - body) < body * 0.15);
      if (dy > 0 && bothBody) gaps.push(dy);
    }
    // Normal line spacing is the most common gap; paragraph gaps are the minority, so take a low percentile.
    const lineGap = percentile(gaps, 0.3) || body * 1.3;
    const rights = lines.map((l) => l.right).sort((a, b) => a - b);
    const fullRight = rights[Math.floor(rights.length * 0.9)] ?? 0;
    const lefts = lines.map((l) => l.x).sort((a, b) => a - b);
    const textLeft = lefts[Math.floor(lefts.length * 0.1)] ?? 0;

    lines.forEach((line, i) => {
      const isHeading = line.size >= body * 1.18 && line.text.length < 180;
      const tag: Block['tag'] = isHeading ? (line.size >= body * 1.6 ? 'h2' : 'h3') : 'p';
      const cur = blocks[blocks.length - 1];
      const newPage = i === 0;
      let startNew = true;

      if (cur && prev) {
        const dy = prev.y - line.y;
        if (tag !== 'p' || cur.tag !== 'p') {
          // Multi-line headings: same size, close together.
          startNew = !(tag === cur.tag && Math.abs(line.size - cur.size) < 0.5 && !newPage && dy > 0 && dy < line.size * 1.9);
        } else if (newPage || dy < 0) {
          // New page or next column: continue a paragraph that clearly hasn't ended.
          startNew = endsSentence(cur.text) && !isLower(line.text[0]);
        } else {
          const bigGap = dy > lineGap * 1.45;
          const indented = line.x > textLeft + body * 0.9 && line.x - prev.x > body * 0.9;
          const prevShort = prev.right < fullRight - body * 2.5;
          startNew = bigGap || ((indented || prevShort) && endsSentence(prev.text));
        }
      }

      if (startNew || !cur) {
        blocks.push({ tag, text: line.text, size: line.size, pageMarks: newPage && p > 0 ? [{ page: p + 1, at: 0 }] : [] });
      } else {
        cur.text = tag === 'p' ? joinLines(cur.text, line.text) : `${cur.text} ${line.text}`;
        if (newPage && p > 0) cur.pageMarks.push({ page: p + 1, at: cur.text.length - line.text.length });
      }
      prev = line;
    });
  });
  return blocks;
}

/** Blocks → HTML. Page starts are marked with empty <span data-page>, shown by CSS. */
export function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      let html = '';
      let pos = 0;
      for (const m of b.pageMarks) {
        html += escapeHtml(b.text.slice(pos, m.at)) + `<span data-page="${m.page}"></span>`;
        pos = m.at;
      }
      html += escapeHtml(b.text.slice(pos));
      return `<${b.tag}>${html}</${b.tag}>`;
    })
    .join('\n');
}

const isArabicLetter = (c: number) => (c >= 0x0620 && c <= 0x064a) || (c >= 0x066e && c <= 0x06d3);
/** Letters only Persian/Urdu use: پ چ ژ گ ک ہ ے */
const PERSIAN_ONLY = new Set([0x067e, 0x0686, 0x0698, 0x06af, 0x06a9, 0x06c1, 0x06d2]);

/**
 * Fonts often map Arabic yeh (ي) to the Persian yeh glyph (ی), which looks identical mid-word, so
 * PDFs come out with the wrong letter and words like "ليست" can't be found. In documents that
 * aren't Persian/Urdu, restore ي mid-word and ى at the end of a word.
 */
export function fixArabicYeh(texts: string[]): string[] {
  let persian = 0;
  let farsiYeh = 0;
  for (const t of texts) {
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (PERSIAN_ONLY.has(c)) persian++;
      else if (c === 0x06cc) farsiYeh++;
    }
  }
  if (!farsiYeh || persian > 3) return texts;
  const yeh = String.fromCharCode(0x064a);
  const maksura = String.fromCharCode(0x0649);
  return texts.map((t) => {
    if (t.indexOf(String.fromCharCode(0x06cc)) === -1) return t;
    let out = '';
    for (let i = 0; i < t.length; i++) {
      if (t.charCodeAt(i) !== 0x06cc) {
        out += t[i];
        continue;
      }
      // Skip diacritics to find the next real letter.
      let j = i + 1;
      while (j < t.length && isMark(t.charCodeAt(j))) j++;
      out += j < t.length && isArabicLetter(t.charCodeAt(j)) ? yeh : maksura;
    }
    return out;
  });
}

export function layoutPages(pages: PageText[]): { html: string; chars: number } {
  const lines = stripFurniture(pages.map((p, i) => toLines(p.runs, i)));
  const fixed = fixArabicYeh(lines.flat().map((l) => l.text));
  let k = 0;
  for (const page of lines) for (const l of page) l.text = fixed[k++]!;
  const chars = lines.flat().reduce((n, l) => n + l.text.length, 0);
  return { html: blocksToHtml(toBlocks(lines)), chars };
}

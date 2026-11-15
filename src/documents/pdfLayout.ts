/**
 * Rebuilds a readable document from what a PDF draws: text runs, lines and boxes, pictures.
 *
 * - Text becomes paragraphs, headings, lists, a table of contents, footnotes and code, with bold
 *   and italic kept (pdfText.ts repairs right-to-left text first).
 * - Grids of lines and aligned columns become real tables (pdfTables.ts).
 * - What only makes sense as a picture (photos, diagrams, slides, scanned pages) becomes a figure:
 *   a placeholder naming the page and the area to show, drawn from the original PDF when read.
 * - Running headers, footers and page numbers are dropped; words hyphenated across lines are
 *   re-joined; paragraphs continue across pages.
 *
 * Pure functions with no pdf.js dependency, so they're unit-tested directly.
 */
import { escapeHtml } from './detect';
import { area, contains, EMPTY_GRAPHICS, grow, overlap, union, type Box, type PageGraphics, type Shape } from './pdfGraphics';
import { findAlignedTables, findRuledTables, type Table } from './pdfTables';
import {
  arabicLetterFixer,
  BOLD,
  bracketsReversed,
  ITALIC,
  mirrorBrackets,
  MONO,
  plain,
  SUP,
  toLines,
  type Line,
  type StyledText,
  type TextRun,
} from './pdfText';

export { fixArabicYeh, type TextRun } from './pdfText';

export interface PageText {
  runs: TextRun[];
  /** Lines, boxes and pictures drawn on the page. */
  graphics?: PageGraphics;
  /** The page's visible area [x0, y0, x1, y1] in PDF units. */
  view?: [number, number, number, number];
  /** Share of the page's text drawn invisibly (an OCR layer over a scan), 0..1. */
  invisibleText?: number;
}

export interface LayoutResult {
  html: string;
  /** Characters of real text found. */
  chars: number;
  /** Pages shown as pictures because they have no usable text (scans). */
  scannedPages: number;
  /** Number of figures (areas shown from the original PDF). */
  figures: number;
}

interface Figure {
  box: Box;
  page: number;
  alt: string;
  caption?: Line;
  /** Text recognized by OCR on a scanned page, shown below the picture. */
  ocr?: Line[];
}

type Region = { kind: 'table'; table: Table; caption?: Line; page: number } | { kind: 'figure'; figure: Figure };
type Item = { line: Line } | { region: Region; y: number };

/* ------------------------------------------------------------------ helpers */

const SENTENCE_END = new Set(['.', '!', '?', ':', ';', '"', '”', '»', ')', '؟', '۔', '…', String.fromCharCode(0x3002)]);
const PAGE_NUMBER = /^[-–— ]*(page |p[.] ?|صفحة )?([0-9٠-٩]+|[ivxlcdm]+)( ?([/]|of|sur|de|من) ?[0-9٠-٩]+)?[-–— ]*$/i;
const CAPTION_WORDS = ['figure', 'fig.', 'fig', 'table', 'tableau', 'tabla', 'chart', 'graph', 'image', 'photo', 'illustration', 'source', 'شكل', 'الشكل', 'جدول', 'الجدول', 'صورة', 'الصورة', 'رسم', 'مخطط', 'المخطط'];

const norm = (s: string) => s.toLowerCase().replace(/[0-9٠-٩]+/g, '#');

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
const isDigitChar = (c: number) => (c >= 0x30 && c <= 0x39) || (c >= 0x660 && c <= 0x669) || (c >= 0x6f0 && c <= 0x6f9);
const allFlag = (t: StyledText, flag: number) => t.chars.some((c) => c !== ' ') && t.chars.every((c, i) => c === ' ' || t.flags[i]! & flag);
const flagShare = (t: StyledText, flag: number) => {
  let n = 0;
  let total = 0;
  t.chars.forEach((c, i) => {
    if (c === ' ') return;
    total++;
    if (t.flags[i]! & flag) n++;
  });
  return total ? n / total : 0;
};

function slice(t: StyledText, from: number, to = t.chars.length): StyledText {
  return { chars: t.chars.slice(from, to), flags: t.flags.slice(from, to) };
}

function trimStyled(t: StyledText): StyledText {
  let a = 0;
  let b = t.chars.length;
  while (a < b && t.chars[a] === ' ') a++;
  while (b > a && t.chars[b - 1] === ' ') b--;
  return slice(t, a, b);
}

/** "infor-" + "mation" → "information" (only when the next line continues in lower case). */
function joinStyled(a: StyledText, b: StyledText): StyledText {
  const last = a.chars[a.chars.length - 1];
  const before = a.chars[a.chars.length - 2] ?? '';
  if ((last === '-' || last === String.fromCharCode(0xad)) && /[A-Za-zÀ-ɏ]/.test(before) && isLower(b.chars[0])) {
    return { chars: [...a.chars.slice(0, -1), ...b.chars], flags: [...a.flags.slice(0, -1), ...b.flags] };
  }
  const space = (a.flags[a.flags.length - 1] ?? 0) & (b.flags[0] ?? 0) & (BOLD | ITALIC);
  return { chars: [...a.chars, ' ', ...b.chars], flags: [...a.flags, space, ...b.flags] };
}

/* ------------------------------------------------------------------ styled text → HTML */

function styledHtml(t: StyledText, marks: { page: number; at: number }[] = [], drop = 0): string {
  let html = '';
  let open = 0;
  const tags: [number, string][] = [
    [SUP, 'sup'],
    [BOLD, 'strong'],
    [ITALIC, 'em'],
    [MONO, 'code'],
  ];
  const close = () => {
    for (const [f, tag] of [...tags].reverse()) if (open & f) html += `</${tag}>`;
    open = 0;
  };
  let m = 0;
  for (let i = 0; i <= t.chars.length; i++) {
    while (m < marks.length && marks[m]!.at === i) {
      close();
      html += `<span data-page="${marks[m]!.page}"></span>`;
      m++;
    }
    if (i === t.chars.length) break;
    const want = t.flags[i]! & ~drop;
    if (want !== open) {
      close();
      for (const [f, tag] of tags) if (want & f) html += `<${tag}>`;
      open = want;
    }
    html += escapeHtml(t.chars[i]!);
  }
  close();
  return html;
}

/* ------------------------------------------------------------------ running headers and footers */

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
  // Long documents: on 40% of pages. Short ones (2 or 3 pages): on every page.
  const threshold = pages.length >= 4 ? Math.max(3, pages.length * 0.4) : pages.length;
  return pages.map((lines) => {
    const edges = new Set(edge(lines));
    return lines.filter((l) => {
      if (!edges.has(l)) return true;
      if (PAGE_NUMBER.test(l.text)) return false;
      return pages.length < 2 || (counts.get(norm(l.text)) ?? 0) < threshold || l.text.length > 160;
    });
  });
}

/* ------------------------------------------------------------------ figures */

const clip = (b: Box, to: Box): Box => ({ x0: Math.max(b.x0, to.x0), y0: Math.max(b.y0, to.y0), x1: Math.min(b.x1, to.x1), y1: Math.min(b.y1, to.y1) });

/**
 * Areas of the page that only make sense as a picture: photos, diagrams (boxes joined by lines),
 * charts. Coloured boxes behind ordinary paragraphs are backgrounds, not figures.
 */
function findFigures(g: PageGraphics, runs: TextRun[], view: Box, tables: Box[], page: number): { figures: Figure[]; rest: TextRun[] } {
  const pageArea = area(view);
  const inset = { x0: view.x0 + (view.x1 - view.x0) * 0.04, y0: view.y0 + (view.y1 - view.y0) * 0.04, x1: view.x1 - (view.x1 - view.x0) * 0.04, y1: view.y1 - (view.y1 - view.y0) * 0.04 };
  // Page borders and ornaments live in the margins; full-page fills are the page's colour.
  const decorative = (b: Box) => !overlap(b, inset) || area(b) > pageArea * 0.85;
  // Drawings that run off the page's edge (slide swooshes, bands, corner art) are ornaments too.
  const bleeds = (b: Box) => b.x0 < view.x0 - 2 || b.y0 < view.y0 - 2 || b.x1 > view.x1 + 2 || b.y1 > view.y1 + 2;
  const inTable = (b: Box) => tables.some((t) => overlap(b, grow(t, 2)) > area(b) * 0.5);
  const textIn = (b: Box) => runs.filter((r) => contains(b, r.x + r.width / 2, r.y + r.size * 0.3));

  type El = { box: Box; strong: boolean; image?: boolean };
  const els: El[] = [];
  for (const img of g.images) {
    if (decorative(img) || inTable(img)) continue;
    const a = area(img);
    if (a < pageArea * 0.004 || img.x1 - img.x0 < 16 || img.y1 - img.y0 < 16) continue; // icons, bullets
    els.push({ box: img, strong: a > pageArea * 0.01, image: true });
  }
  for (const s of g.shapes) {
    if (decorative(s) || bleeds(s) || inTable(s)) continue;
    const w = s.x1 - s.x0;
    const h = s.y1 - s.y0;
    if (w < 4 && h < 4) continue;
    const inside = textIn(s);
    const chars = inside.reduce((n, r) => n + r.str.trim().length, 0);
    if (inside.length) {
      const span = Math.max(...inside.map((r) => r.x + r.width)) - Math.min(...inside.map((r) => r.x));
      const lineH = Math.max(...inside.map((r) => r.size));
      // A panel behind running text (a coloured box around paragraphs): the text reads normally.
      if (chars > 150 && span > w * 0.55) continue;
      // A bar behind a single heading or label: weak on its own.
      if (h < lineH * 2.6) {
        els.push({ box: s, strong: false });
        continue;
      }
    }
    els.push({ box: s, strong: s.curved || area(s) > pageArea * 0.01 || (s.stroked && !s.filled && inside.length > 0) });
  }
  for (const r of g.rules) {
    if (decorative(r) || bleeds(r) || inTable(r)) continue;
    els.push({ box: { x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 }, strong: false });
  }
  if (!els.length) return { figures: [], rest: runs };

  // Elements close to each other form one figure.
  const groups: El[][] = [];
  for (const el of els) {
    const near = groups.filter((gr) => gr.some((o) => overlap(grow(o.box, 8), grow(el.box, 8)) > 0));
    const merged = [el, ...near.flat()];
    for (const n of near) groups.splice(groups.indexOf(n), 1);
    groups.push(merged);
  }

  const figures: Figure[] = [];
  let rest = runs;
  for (const gr of groups) {
    const strong = gr.filter((e) => e.strong).length;
    const weak = gr.length - strong;
    const isFigure = gr.some((e) => e.image && e.strong) || strong >= 2 || (strong >= 1 && weak >= 2) || weak >= 5;
    if (!isFigure) continue;
    let box = gr.map((e) => e.box).reduce(union);
    if (area(box) < pageArea * 0.01) continue;
    // Labels that stick out of the drawing belong to it.
    for (const r of rest) {
      const rb = { x0: r.x, x1: r.x + r.width, y0: r.y - r.size * 0.25, y1: r.y + r.size };
      if (overlap(rb, box) > area(rb) * 0.4) box = union(box, rb);
    }
    const inside = rest.filter((r) => contains(box, r.x + r.width / 2, r.y + r.size * 0.3, 1));
    // Mostly running text with a few lines around it: not a figure, read it as text.
    const lines = toLines(inside, page);
    const long = lines.filter((l) => l.right - l.x > (box.x1 - box.x0) * 0.6 && l.text.length > 50);
    if (long.length >= 3 && long.length >= lines.length * 0.5) continue;
    figures.push({ box: clip(grow(box, 3), view), page, alt: lines.map((l) => l.text).join(' ').slice(0, 600) });
    const used = new Set(inside);
    rest = rest.filter((r) => !used.has(r));
  }
  return { figures, rest };
}

/* ------------------------------------------------------------------ lists, contents, notes */

const BULLETS = new Set(['•', '●', '▪', '■', '◦', '○', '‣', '⁃', '◆', '◇', '❖', '➢', '➤', '►', '▶', '✓', '✔', '✗', '–', '—', '-', '*', '·', '□', '❑', '⬤', '⮚', '→']);
const LEADERS = new Set(['.', '…', '_', '·', '•', '-']);

interface Marker {
  ordered: boolean;
  /** Number for ordered lists counted 1, 2, 3 (or ١، ٢، ٣). */
  value?: number;
  /** The marker as written, kept for lists that aren't plain numbers (أ- ب- / a) b)). */
  label: string;
  /** Where the item's own text starts. */
  rest: number;
}

const toNumber = (s: string) => {
  let n = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    const d = c >= 0x660 && c <= 0x669 ? c - 0x660 : c >= 0x6f0 && c <= 0x6f9 ? c - 0x6f0 : c - 0x30;
    n = n * 10 + d;
  }
  return n;
};

/** "1. ", "١- ", "(3) ", "a) ", "أ- ", "• " at the start of a line. */
function listMarker(t: StyledText): Marker | null {
  const ch = t.chars;
  if (!ch.length) return null;
  const c0 = ch[0]!.charCodeAt(0);
  if ((BULLETS.has(ch[0]!) || (c0 >= 0xe000 && c0 <= 0xf8ff)) && ch[1] === ' ' && ch.length > 2) return { ordered: false, label: ch[0]!, rest: 2 };

  let i = 0;
  const paren = ch[0] === '(';
  if (paren) i++;
  let token = '';
  let kind: 'num' | 'latin' | 'arabic' | '' = '';
  while (i < ch.length && isDigitChar(ch[i]!.charCodeAt(0)) && token.length < 3) token += ch[i++];
  if (token) kind = 'num';
  else {
    const c = ch[i]?.charCodeAt(0) ?? 0;
    if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)) kind = 'latin';
    else if (c >= 0x621 && c <= 0x64a) kind = 'arabic';
    if (kind) token = ch[i++]!;
  }
  if (!kind || i >= ch.length) return null;
  const delim = ch[i]!;
  const okDelim = paren ? delim === ')' : kind === 'num' ? '.)-–/'.includes(delim) : ')-–'.includes(delim);
  if (!okDelim || ch[i + 1] !== ' ' || i + 2 >= ch.length) return null;
  if (kind === 'num' && toNumber(token) > 99) return null;
  const label = ch.slice(0, i + 1).join('');
  return kind === 'num' ? { ordered: true, value: toNumber(token), label, rest: i + 2 } : { ordered: true, label, rest: i + 2 };
}

/** "Chapter one ........ 12": title and page number, without the dots. */
function tocEntry(t: StyledText): { title: StyledText; pageNo: string } | null {
  const ch = t.chars;
  let start = -1;
  let count = 0;
  for (let i = 0; i < ch.length; i++) {
    if (LEADERS.has(ch[i]!)) {
      if (start < 0) start = i;
      count += ch[i] === '…' ? 3 : 1;
    } else if (ch[i] === ' ' && start >= 0 && LEADERS.has(ch[i + 1] ?? '')) {
      // ". . . ." leaders with spaces
    } else {
      if (count >= 4) break;
      start = -1;
      count = 0;
    }
  }
  if (count < 4 || start <= 0) return null;
  let end = start;
  while (end < ch.length && (LEADERS.has(ch[end]!) || ch[end] === ' ')) end++;
  const pageNo = ch.slice(end).join('').trim();
  if (!pageNo || pageNo.length > 6 || !/^[0-9٠-٩۰-۹ivxlcdm]+$/i.test(pageNo)) return null;
  const title = trimStyled(slice(t, 0, start));
  return title.chars.length ? { title, pageNo } : null;
}

/** A small filled shape just before the line's first word: a bullet drawn as a picture. */
function hasBulletShape(line: Line, shapes: Shape[]): boolean {
  return shapes.some((s) => {
    const w = s.x1 - s.x0;
    const h = s.y1 - s.y0;
    if (!s.filled || w > line.size * 0.7 || h > line.size * 0.7 || w < 1) return false;
    const cy = (s.y0 + s.y1) / 2;
    if (cy < line.y - line.size * 0.2 || cy > line.y + line.size * 0.8) return false;
    return line.rtl ? s.x0 >= line.right - 1 && s.x0 <= line.right + line.size * 2.5 : s.x1 <= line.x + 1 && s.x1 >= line.x - line.size * 2.5;
  });
}

/* ------------------------------------------------------------------ blocks */

type Block =
  | { kind: 'text'; tag: 'p' | 'h2' | 'h3' | 'h4' | 'note'; text: StyledText; size: number; marks: { page: number; at: number }[]; lines: number; rtl: boolean }
  | { kind: 'li'; marker: Marker; text: StyledText; marks: { page: number; at: number }[]; rtl: boolean; indent: number; startLine: Line }
  | { kind: 'toc'; title: StyledText; pageNo: string; level: number; marks: { page: number; at: number }[]; rtl: boolean }
  | { kind: 'code'; lines: string[]; marks: { page: number; at: number }[] }
  | { kind: 'region'; region: Region; mark?: number };

function toBlocks(pages: Item[][], body: number, bullets: Set<Line>): Block[] {
  const blocks: Block[] = [];
  let prev: Line | null = null;
  let pendingMark: number | null = null;

  pages.forEach((items, p) => {
    const lines = items.flatMap((it) => ('line' in it ? [it.line] : []));
    const gaps: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const dy = lines[i - 1]!.y - lines[i]!.y;
      const bothBody = [lines[i - 1]!, lines[i]!].every((l) => Math.abs(l.size - body) < body * 0.15);
      if (dy > 0 && bothBody) gaps.push(dy);
    }
    // Normal line spacing is the most common gap; paragraph gaps are the minority, so take a low percentile.
    const lineGap = percentile(gaps, 0.3) || body * 1.3;
    const fullRight = percentile(lines.map((l) => l.right), 0.9);
    const fullLeft = percentile(lines.map((l) => l.x), 0.1);
    // Footnotes: small lines below the last line of body text.
    const lastBody = lines.reduce((min, l) => (l.size >= body * 0.92 ? Math.min(min, l.y) : min), Infinity);
    const tocIndent = lines.filter((l) => tocEntry(l.styled)).map((l) => (l.rtl ? fullRight - l.right : l.x - fullLeft));
    const tocBase = tocIndent.length ? Math.min(...tocIndent) : 0;
    if (p > 0) pendingMark = p + 1;

    let first = true;
    for (const it of items) {
      if ('region' in it) {
        blocks.push({ kind: 'region', region: it.region, mark: pendingMark ?? undefined });
        pendingMark = null;
        prev = null;
        continue;
      }
      const line = it.line;
      const newPage = first;
      first = false;
      const marks = () => {
        const m = pendingMark ? [{ page: pendingMark, at: 0 }] : [];
        pendingMark = null;
        return m;
      };
      const cur = blocks[blocks.length - 1];
      const dy = prev ? prev.y - line.y : 0;
      const bigGap = !!prev && dy > lineGap * 1.45;

      // Code: a whole line in a monospaced font. Keep its line breaks and indentation.
      if (allFlag(line.styled, MONO) && line.text.length > 1) {
        const indent = ' '.repeat(Math.max(0, Math.round((line.x - fullLeft) / (line.size * 0.6))));
        if (cur?.kind === 'code' && !bigGap && !newPage) cur.lines.push(indent + line.text);
        else blocks.push({ kind: 'code', lines: [indent + line.text], marks: marks() });
        prev = line;
        continue;
      }

      // Table of contents entry.
      const toc = tocEntry(line.styled);
      if (toc) {
        const off = (line.rtl ? fullRight - line.right : line.x - fullLeft) - tocBase;
        blocks.push({ kind: 'toc', title: toc.title, pageNo: toc.pageNo, level: Math.min(3, 1 + Math.max(0, Math.round(off / (line.size * 1.2)))), marks: marks(), rtl: line.rtl });
        prev = line;
        continue;
      }

      // Footnotes.
      if (line.size < body * 0.88 && line.y < lastBody && !newPage) {
        const starts = listMarker(line.styled) || (line.styled.flags[0]! & SUP) || isDigitChar(line.text.charCodeAt(0));
        if (cur?.kind === 'text' && cur.tag === 'note' && !starts && !bigGap) cur.text = joinStyled(cur.text, line.styled);
        else blocks.push({ kind: 'text', tag: 'note', text: line.styled, size: line.size, marks: marks(), lines: 1, rtl: line.rtl });
        prev = line;
        continue;
      }

      // Lists.
      const marker = listMarker(line.styled) ?? (bullets.has(line) ? { ordered: false, label: '•', rest: 0 } : null);
      if (marker && line.size < body * 1.18) {
        const indent = line.rtl ? fullRight - line.right : line.x - fullLeft;
        blocks.push({ kind: 'li', marker, text: trimStyled(slice(line.styled, marker.rest)), marks: marks(), rtl: line.rtl, indent, startLine: line });
        prev = line;
        continue;
      }
      if (cur?.kind === 'li' && prev && !newPage && !bigGap && dy > 0 && line.size < body * 1.18) {
        // A wrapped list item: indented past its marker, or continuing an unfinished sentence.
        const start = cur.startLine;
        const hanging = line.rtl ? line.right < start.right - line.size * 0.4 : line.x > start.x + line.size * 0.4;
        if (hanging || !endsSentence(plain(cur.text))) {
          cur.text = joinStyled(cur.text, line.styled);
          prev = line;
          continue;
        }
      }

      // Word's Heading 1 and 2 are about 1.45 and 1.18 times the body size; web pages printed to
      // PDF use similar steps (17 and 13.5 over 11.5).
      const isHeading = line.size >= body * 1.15 && line.text.length < 180;
      const tag = isHeading ? (line.size >= body * 1.4 ? 'h2' : 'h3') : 'p';
      let startNew = true;
      if (cur?.kind === 'text' && cur.tag !== 'note' && prev) {
        if (tag !== 'p' || cur.tag !== 'p') {
          // Multi-line headings: same size, close together.
          startNew = !(tag === cur.tag && Math.abs(line.size - cur.size) < 0.5 && !newPage && dy > 0 && dy < line.size * 1.9);
        } else if (newPage || dy < 0) {
          // New page or next column: continue a paragraph that clearly hasn't ended.
          startNew = endsSentence(plain(cur.text)) && !isLower(line.text[0]);
        } else {
          const indented = line.rtl
            ? line.right < fullRight - body * 0.9 && prev.right - line.right > body * 0.9
            : line.x > fullLeft + body * 0.9 && line.x - prev.x > body * 0.9;
          const prevShort = line.rtl ? prev.x > fullLeft + body * 2.5 : prev.right < fullRight - body * 2.5;
          // A bold line on its own is a heading; a change of font weight starts a new block.
          const boldChange = allFlag(prev.styled, BOLD) !== allFlag(line.styled, BOLD) && (allFlag(prev.styled, BOLD) ? endsSentence(prev.text) || prev.text.length < 90 : endsSentence(prev.text));
          startNew = bigGap || ((indented || prevShort) && endsSentence(prev.text)) || boldChange;
        }
      }

      if (startNew || cur?.kind !== 'text') {
        blocks.push({ kind: 'text', tag, text: line.styled, size: line.size, marks: marks(), lines: 1, rtl: line.rtl });
      } else {
        cur.text = joinStyled(cur.text, line.styled);
        cur.lines++;
        if (pendingMark) {
          // The page starts where this line's text starts in the joined paragraph.
          cur.marks.push({ page: pendingMark, at: cur.text.chars.length - line.styled.chars.length });
          pendingMark = null;
        }
      }
      prev = line;
    }
  });
  return blocks;
}

/* ------------------------------------------------------------------ HTML */

const figureHtml = (f: Figure, mark?: number) => {
  const box = [f.box.x0, f.box.y0, f.box.x1, f.box.y1].map((v) => Math.round(v * 10) / 10).join(' ');
  const label = f.alt ? ` aria-label="${escapeHtml(f.alt)}"` : '';
  const caption = f.caption ? `<figcaption>${styledHtml(f.caption.styled)}</figcaption>` : '';
  const pageMark = mark ? `<span data-page="${mark}"></span>` : '';
  const ocr = f.ocr?.length
    ? `<details data-ocr><summary>Text recognized on this page</summary>${f.ocr.map((l) => `<p>${styledHtml(l.styled)}</p>`).join('')}</details>`
    : '';
  return `<figure data-pdf-page="${f.page + 1}" data-pdf-box="${box}">${pageMark}<div data-pdf-figure role="img"${label}></div>${caption}</figure>${ocr}`;
};

function cellHtml(lines: Line[]): string {
  let out: StyledText | null = null;
  const parts: string[] = [];
  for (const l of lines) {
    if (out && (listMarker(l.styled) || endsSentence(plain(out)) && l.text.length < 40)) {
      parts.push(styledHtml(out));
      out = null;
    }
    out = out ? joinStyled(out, l.styled) : l.styled;
  }
  if (out) parts.push(styledHtml(out));
  return parts.join('<br>');
}

function tableHtml(t: Table, caption?: Line, mark?: number): string {
  const rows: string[] = [];
  for (let r = 0; r < t.rows; r++) {
    const cells = t.cells.filter((c) => c.row === r).sort((a, b) => (t.rtl ? b.col - a.col : a.col - b.col));
    if (!cells.length) continue;
    const tag = t.header && r === 0 ? 'th' : 'td';
    rows.push(
      `<tr>${cells
        .map((c) => {
          const span = (c.colSpan > 1 ? ` colspan="${c.colSpan}"` : '') + (c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : '');
          return `<${tag}${span}>${cellHtml(c.lines)}</${tag}>`;
        })
        .join('')}</tr>`,
    );
  }
  const head = t.header ? `<thead>${rows.shift()}</thead>` : '';
  const cap = caption ? `<caption>${styledHtml(caption.styled)}</caption>` : '';
  const pageMark = mark ? `<p><span data-page="${mark}"></span></p>` : '';
  return `${pageMark}<table dir="${t.rtl ? 'rtl' : 'ltr'}">${cap}${head}<tbody>${rows.join('')}</tbody></table>`;
}

export function blocksToHtml(blocks: Block[], dropBold: boolean): string {
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind === 'region') {
      out.push(b.region.kind === 'table' ? tableHtml(b.region.table, b.region.caption, b.mark) : figureHtml(b.region.figure, b.mark));
    } else if (b.kind === 'code') {
      out.push(`<pre>${styledHtml({ chars: [], flags: [] }, b.marks)}<code>${escapeHtml(b.lines.join(String.fromCharCode(10)))}</code></pre>`);
    } else if (b.kind === 'toc') {
      const items: string[] = [];
      let j = i;
      while (j < blocks.length && blocks[j]!.kind === 'toc') {
        const e = blocks[j] as Extract<Block, { kind: 'toc' }>;
        items.push(`<li data-level="${e.level}">${styledHtml(e.title, e.marks, BOLD)}<span data-toc-page>${escapeHtml(e.pageNo)}</span></li>`);
        j++;
      }
      out.push(`<ol data-toc>${items.join('')}</ol>`);
      i = j - 1;
    } else if (b.kind === 'li') {
      // Consecutive items with the same kind of marker form one list.
      const items: Extract<Block, { kind: 'li' }>[] = [];
      let j = i;
      while (j < blocks.length && blocks[j]!.kind === 'li' && (blocks[j] as Extract<Block, { kind: 'li' }>).marker.ordered === b.marker.ordered) {
        items.push(blocks[j] as Extract<Block, { kind: 'li' }>);
        j++;
      }
      i = j - 1;
      const numbers = items.map((it) => it.marker.value);
      const counted = b.marker.ordered && numbers.every((n, k) => n !== undefined && n === numbers[0]! + k);
      const minIndent = Math.min(...items.map((it) => it.indent));
      const lis = items
        .map((it) => {
          const level = Math.min(3, 1 + Math.round((it.indent - minIndent) / 18));
          const label = b.marker.ordered && !counted ? `${escapeHtml(it.marker.label)} ` : '';
          return `<li${level > 1 ? ` data-level="${level}"` : ''}>${label}${styledHtml(it.text, it.marks, dropBold ? BOLD : 0)}</li>`;
        })
        .join('');
      const dir = items.filter((it) => it.rtl).length > items.length / 2 ? ' dir="rtl"' : '';
      if (counted) out.push(`<ol${numbers[0] !== 1 ? ` start="${numbers[0]}"` : ''}${dir}>${lis}</ol>`);
      else out.push(`<ul${b.marker.ordered ? ' data-markers' : ''}${dir}>${lis}</ul>`);
    } else {
      // A short line set entirely in bold, on its own, is a heading ("Article 4", "Definitions").
      const t = plain(b.text);
      const tag = b.tag === 'p' && !dropBold && b.lines === 1 && allFlag(b.text, BOLD) && t.length <= 90 && !/[.,،;!؟?]$/.test(t) ? 'h4' : b.tag;
      const drop = (tag !== 'p' && tag !== 'note') || dropBold || flagShare(b.text, BOLD) > 0.6 ? BOLD : 0;
      const dropItalic = flagShare(b.text, ITALIC) > 0.8 && tag !== 'p' ? ITALIC : 0;
      const html = styledHtml(b.text, b.marks, drop | dropItalic);
      if (tag === 'note') out.push(`<p data-note>${html}</p>`);
      else out.push(`<${tag}>${html}</${tag}>`);
    }
  }
  return out.join(String.fromCharCode(10));
}

/* ------------------------------------------------------------------ pages */

/** Captions: "Figure 2. …" just below or above a figure or table. */
function takeCaption(lines: Line[], box: Box): Line | undefined {
  const cand = lines.filter((l) => {
    const below = box.y0 - l.y;
    const above = l.y - box.y1;
    const near = (below > 0 && below < l.size * 3) || (above >= -l.size * 0.5 && above < l.size * 2.5);
    const word = l.text.toLowerCase().split(' ')[0] ?? '';
    return near && l.x < box.x1 && l.right > box.x0 && CAPTION_WORDS.some((w) => word === w || word.startsWith(w + ' ') || (word.startsWith(w) && /[0-9٠-٩.:]/.test(word.slice(w.length, w.length + 1))));
  });
  return cand[0];
}

/** Place each table and figure before the first line below its top that it sits above. */
function placeRegions(lines: Line[], regions: { region: Region; box: Box }[]): Item[] {
  const items: Item[] = lines.map((line) => ({ line }));
  const sorted = [...regions].sort((a, b) => b.box.y1 - a.box.y1);
  for (const { region, box } of sorted) {
    let at = items.findIndex((it) => 'line' in it && it.line.y < box.y1 && it.line.x < box.x1 && it.line.right > box.x0);
    if (at < 0) at = items.findIndex((it) => 'line' in it && it.line.y < box.y0);
    // Keep regions that sit at the same height in order.
    while (at > 0 && 'region' in items[at - 1]! && (items[at - 1] as { y: number }).y < box.y1) at--;
    const item: Item = { region, y: box.y1 };
    if (at < 0) items.push(item);
    else items.splice(at, 0, item);
  }
  return items;
}

export function layoutPages(pages: PageText[]): LayoutResult {
  let scannedPages = 0;
  let figureCount = 0;
  const pageLines: Line[][] = [];
  const pageRegions: { region: Region; box: Box }[][] = [];
  const bullets = new Set<Line>();

  pages.forEach((pg, p) => {
    const g = pg.graphics ?? EMPTY_GRAPHICS;
    const runs = pg.runs.filter((r) => r.str.length);
    const extent = runs.length
      ? { x0: Math.min(...runs.map((r) => r.x)), y0: Math.min(...runs.map((r) => r.y)), x1: Math.max(...runs.map((r) => r.x + r.width)), y1: Math.max(...runs.map((r) => r.y + r.size)) }
      : { x0: 0, y0: 0, x1: 612, y1: 792 };
    const view = pg.view ? { x0: pg.view[0], y0: pg.view[1], x1: pg.view[2], y1: pg.view[3] } : extent;
    const pageArea = area(view);
    const chars = runs.reduce((n, r) => n + r.str.trim().length, 0);
    const imageCover = g.images.reduce((a, img) => a + overlap(img, view), 0) / pageArea;

    // Scanned pages: a picture of the page, with no text (or an OCR layer over it).
    if ((chars < 20 && imageCover > 0.3) || (imageCover > 0.6 && (pg.invisibleText ?? 0) > 0.5)) {
      scannedPages++;
      figureCount++;
      const ocr = chars >= 20 ? toLines(runs, p) : undefined;
      pageLines.push([]);
      pageRegions.push([{ region: { kind: 'figure', figure: { box: view, page: p, alt: '', ocr } }, box: view }]);
      return;
    }

    const regions: { region: Region; box: Box }[] = [];
    const { tables, rest: afterTables } = findRuledTables(g.rules, runs, p, g.shapes);
    const { figures, rest } = findFigures(g, afterTables, view, tables.map((t) => t.box), p);
    let lines = toLines(rest, p);

    // Slides and posters: when pictures cover the page and little text is left, show the page.
    const figArea = figures.reduce((a, f) => a + area(f.box), 0);
    const restChars = lines.reduce((n, l) => n + l.text.length, 0);
    if (figures.length && figArea > pageArea * 0.3 && restChars < 120 && !tables.length) {
      const all = [...figures.map((f) => f.box), ...lines.map((l) => ({ x0: l.x, x1: l.right, y0: l.y - l.size * 0.3, y1: l.y + l.size }))].reduce(union);
      figures.splice(0, figures.length, { box: clip(grow(all, 4), view), page: p, alt: [...figures.map((f) => f.alt), ...lines.map((l) => l.text)].join(' ').slice(0, 600) });
      lines = [];
    }

    for (const t of tables) regions.push({ region: { kind: 'table', table: t, page: p }, box: t.box });
    for (const f of figures) regions.push({ region: { kind: 'figure', figure: f }, box: f.box });
    figureCount += figures.length;

    // Borderless tables among the remaining lines.
    const textWidth = percentile(lines.map((l) => l.right), 0.9) - percentile(lines.map((l) => l.x), 0.1);
    const aligned = findAlignedTables(lines, p, textWidth);
    const consumed = new Set<Line>();
    for (const a of aligned) {
      regions.push({ region: { kind: 'table', table: a.table, page: p }, box: a.table.box });
      for (let k = a.from; k <= a.to; k++) consumed.add(lines[k]!);
    }
    lines = lines.filter((l) => !consumed.has(l));

    // Captions travel with their figure or table.
    for (const r of regions) {
      const cap = takeCaption(lines, r.box);
      if (!cap) continue;
      if (r.region.kind === 'figure') r.region.figure.caption = cap;
      else r.region.caption = cap;
      lines = lines.filter((l) => l !== cap);
    }
    for (const l of lines) if (hasBulletShape(l, g.shapes)) bullets.add(l);
    pageLines.push(lines);
    pageRegions.push(regions);
  });

  const stripped = stripFurniture(pageLines);

  // Document-wide repairs: look-alike letters, and brackets in right-to-left lines.
  const allLines = [
    ...stripped.flat(),
    ...pageRegions.flat().flatMap(({ region }) => (region.kind === 'table' ? region.table.cells.flatMap((c) => c.lines) : [...(region.figure.ocr ?? []), ...(region.figure.caption ? [region.figure.caption] : [])])),
  ];
  const fixLetters = arabicLetterFixer(allLines.map((l) => l.text));
  const mirror = bracketsReversed(allLines.filter((l) => l.rtl).map((l) => l.text));
  for (const l of allLines) {
    if (fixLetters) l.styled = { chars: fixLetters(l.styled.chars), flags: l.styled.flags };
    if (mirror && l.rtl) l.styled = mirrorBrackets(l.styled);
    l.text = plain(l.styled);
  }

  const body = bodySize(stripped.flat());
  const items = stripped.map((lines, p) => placeRegions(lines, pageRegions[p]!));
  const blocks = toBlocks(items, body, bullets);
  // When nearly everything is bold (some slide decks), bold carries no meaning.
  const textLines = stripped.flat();
  const boldShare = textLines.reduce((n, l) => n + l.styled.flags.filter((f) => f & BOLD).length, 0) / Math.max(1, textLines.reduce((n, l) => n + l.styled.chars.length, 0));
  const chars = allLines.reduce((n, l) => n + l.text.length, 0);
  return { html: blocksToHtml(blocks, boldShare > 0.5), chars, scannedPages, figures: figureCount };
}

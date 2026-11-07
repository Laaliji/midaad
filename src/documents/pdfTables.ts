/**
 * Tables in PDFs. A PDF has no notion of a table: just text, and lines drawn around it.
 *
 * - Ruled tables: horizontal and vertical lines that cross form a grid. Missing inner lines mean
 *   merged cells (colspan/rowspan).
 * - Borderless tables: several consecutive lines split into the same columns by wide gaps.
 *
 * Pure geometry, no pdf.js dependency.
 */
import { contains, type Box, type Rule, type Shape } from './pdfGraphics';
import { letterDirection, lineFromRuns, toLines, type Line, type TextRun } from './pdfText';

export interface Cell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  lines: Line[];
}

export interface Table {
  box: Box;
  rows: number;
  cols: number;
  cells: Cell[];
  rtl: boolean;
  /** The first row is a header (bold, or set apart by a rule). */
  header: boolean;
}

const TOL = 2;

/* ------------------------------------------------------------------ ruled tables */

/** Join pieces of the same line (tables are often drawn one cell edge at a time). */
function mergeRules(rules: Rule[], horizontal: boolean): Rule[] {
  const key = (r: Rule) => (horizontal ? r.y0 : r.x0);
  const start = (r: Rule) => (horizontal ? r.x0 : r.y0);
  const end = (r: Rule) => (horizontal ? r.x1 : r.y1);
  const sorted = rules.filter((r) => r.horizontal === horizontal).sort((a, b) => key(a) - key(b) || start(a) - start(b));
  const out: Rule[] = [];
  for (const r of sorted) {
    const same = out.find((o) => Math.abs(key(o) - key(r)) <= TOL && start(r) <= end(o) + TOL && end(r) >= start(o) - TOL);
    if (same) {
      if (horizontal) {
        same.x0 = Math.min(same.x0, r.x0);
        same.x1 = Math.max(same.x1, r.x1);
      } else {
        same.y0 = Math.min(same.y0, r.y0);
        same.y1 = Math.max(same.y1, r.y1);
      }
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** Sorted distinct values, merging those closer than TOL. */
function distinct(values: number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    if (!out.length || v - out[out.length - 1]! > TOL * 1.5) out.push(v);
  }
  return out;
}

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]!]!;
    return i;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

/** How much of [a0, a1] the rules at `pos` cover (0..1). */
function coverage(rules: Rule[], horizontal: boolean, pos: number, a0: number, a1: number): number {
  let covered = 0;
  for (const r of rules) {
    if (Math.abs((horizontal ? r.y0 : r.x0) - pos) > TOL * 1.5) continue;
    const s = Math.max(a0, horizontal ? r.x0 : r.y0);
    const e = Math.min(a1, horizontal ? r.x1 : r.y1);
    if (e > s) covered += e - s;
  }
  return a1 > a0 ? covered / (a1 - a0) : 0;
}

/**
 * Tables drawn with row lines only, as web pages printed to PDF often are: no vertical lines, but
 * each row line is drawn one cell at a time, so its pieces meet where the columns meet. A stack
 * of row lines that span the same width and meet at the same places implies the column lines.
 * Header cells drawn as filled boxes give the header's top line, and a border drawn around the
 * whole table closes a last row that has no line under it.
 *
 * Returns the lines to add: the implied column lines, and row lines taken from boxes.
 */
export function impliedRules(rules: Rule[], shapes: Shape[], runs: TextRun[]): Rule[] {
  interface Level {
    y: number;
    pieces: { x0: number; x1: number }[];
    drawn: boolean;
  }
  const pieces = [
    ...rules.filter((r) => r.horizontal).map((r) => ({ y: r.y0, x0: r.x0, x1: r.x1, drawn: true })),
    ...shapes
      .filter((s) => s.filled && !s.curved && s.y1 - s.y0 < 80)
      .flatMap((s) => [
        { y: s.y1, x0: s.x0, x1: s.x1, drawn: false },
        { y: s.y0, x0: s.x0, x1: s.x1, drawn: false },
      ]),
  ];
  const levels: Level[] = [];
  for (const p of pieces) {
    const level = levels.find((l) => Math.abs(l.y - p.y) <= TOL);
    if (level) {
      level.pieces.push(p);
      level.drawn ||= p.drawn;
    } else {
      levels.push({ y: p.y, pieces: [p], drawn: p.drawn });
    }
  }

  // Each level's width and the places where its pieces meet. A level with gaps (fraction bars
  // side by side, underlined words) isn't a row line: it gets no joins and joins no stack.
  const sig = (l: Level) => {
    const sorted = [...l.pieces].sort((a, b) => a.x0 - b.x0);
    const x0 = sorted[0]!.x0;
    let x1 = sorted[0]!.x1;
    const joins: number[] = [];
    for (const p of sorted.slice(1)) {
      if (p.x0 > x1 + TOL * 2) return { x0, x1, joins: [] as number[] };
      if (Math.abs(p.x0 - x1) <= TOL * 2) joins.push(p.x0);
      x1 = Math.max(x1, p.x1);
    }
    return { x0, x1, joins: distinct(joins).filter((x) => x > x0 + TOL * 2 && x < x1 - TOL * 2) };
  };
  const same = (a: ReturnType<typeof sig>, b: ReturnType<typeof sig>) =>
    Math.abs(a.x0 - b.x0) <= TOL * 2 &&
    Math.abs(a.x1 - b.x1) <= TOL * 2 &&
    a.joins.length === b.joins.length &&
    a.joins.every((x, i) => Math.abs(x - b.joins[i]!) <= TOL * 2);

  const out: Rule[] = [];
  const used = new Set<Level>();
  for (const first of [...levels].sort((a, b) => b.y - a.y)) {
    if (used.has(first)) continue;
    const s = sig(first);
    if (!s.joins.length) continue;
    const stack = levels.filter((l) => !used.has(l) && same(sig(l), s)).sort((a, b) => b.y - a.y);
    stack.forEach((l) => used.add(l));
    if (stack.length < 3 || !stack.some((l) => l.drawn)) continue;

    let top = stack[0]!.y;
    let bottom = stack[stack.length - 1]!.y;
    const textBetween = (hi: number, lo: number) =>
      runs.some((r) => r.str.trim() && r.x + r.width / 2 > s.x0 && r.x + r.width / 2 < s.x1 && r.y + r.size * 0.3 < hi && r.y + r.size * 0.3 > lo);
    // A border or background around the whole table closes the first and last rows.
    const frame = shapes.find((f) => Math.abs(f.x0 - s.x0) <= 4 && Math.abs(f.x1 - s.x1) <= 4 && f.y1 >= top - TOL && f.y0 <= bottom + TOL);
    if (frame) {
      if (frame.y0 < bottom - 4 && textBetween(bottom, frame.y0)) bottom = frame.y0;
      if (frame.y1 > top + 4 && textBetween(frame.y1, top)) top = frame.y1;
    }

    for (const y of [top, bottom, ...stack.filter((l) => !l.drawn).map((l) => l.y)]) {
      out.push({ x0: s.x0, x1: s.x1, y0: y, y1: y, horizontal: true });
    }
    for (const x of [s.x0, ...s.joins, s.x1]) out.push({ x0: x, x1: x, y0: bottom, y1: top, horizontal: false });
  }
  return out;
}

/**
 * Grids of crossing lines, with the runs that fall inside each cell. Returns the tables and the
 * runs that weren't used.
 */
export function findRuledTables(rules: Rule[], runs: TextRun[], page: number, shapes: Shape[] = []): { tables: Table[]; rest: TextRun[] } {
  const withImplied = [...rules, ...impliedRules(rules, shapes, runs)];
  const hs = mergeRules(withImplied, true);
  const vs = mergeRules(withImplied, false);
  const all = [...hs, ...vs];
  if (hs.length < 2 || vs.length < 2) return { tables: [], rest: runs };

  // Lines that touch or cross belong to the same grid.
  const uf = new UnionFind(all.length);
  hs.forEach((h, i) => {
    vs.forEach((v, j) => {
      if (v.x0 >= h.x0 - TOL * 2 && v.x0 <= h.x1 + TOL * 2 && h.y0 >= v.y0 - TOL * 2 && h.y0 <= v.y1 + TOL * 2) uf.union(i, hs.length + j);
    });
  });
  const groups = new Map<number, Rule[]>();
  all.forEach((r, i) => {
    const k = uf.find(i);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  });

  const tables: Table[] = [];
  let rest = runs;
  for (const group of groups.values()) {
    const gh = group.filter((r) => r.horizontal);
    const gv = group.filter((r) => !r.horizontal);
    if (gh.length < 2 || gv.length < 2) continue;
    const box = {
      x0: Math.min(...group.map((r) => r.x0)),
      x1: Math.max(...group.map((r) => r.x1)),
      y0: Math.min(...group.map((r) => r.y0)),
      y1: Math.max(...group.map((r) => r.y1)),
    };
    // Column and row boundaries (the outer border counts even if it isn't drawn).
    const xs = distinct([box.x0, box.x1, ...gv.map((r) => r.x0)]);
    const ys = distinct([box.y0, box.y1, ...gh.map((r) => r.y0)]).reverse(); // top to bottom
    const cols = xs.length - 1;
    const rows = ys.length - 1;
    if (cols < 2 || rows < 1 || (rows < 2 && cols < 3)) continue;
    // Thin bands are drawing artefacts (double borders), not rows or columns.
    if (xs.some((x, i) => i > 0 && x - xs[i - 1]! < 3) || ys.some((y, i) => i > 0 && ys[i - 1]! - y < 3)) continue;

    const inside = (r: TextRun) => contains(box, r.x + r.width / 2, r.y + r.size * 0.3, 1);
    const tableRuns = rest.filter(inside);
    if (tableRuns.length < 2) continue;

    // Atomic cells, merged where the line between them is missing.
    const id = (r: number, c: number) => r * cols + c;
    const cellUf = new UnionFind(rows * cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols && coverage(gv, false, xs[c + 1]!, ys[r + 1]!, ys[r]!) < 0.6) cellUf.union(id(r, c), id(r, c + 1));
        if (r + 1 < rows && coverage(gh, true, ys[r + 1]!, xs[c]!, xs[c + 1]!) < 0.6) cellUf.union(id(r, c), id(r + 1, c));
      }
    }
    const spans = new Map<number, { r0: number; r1: number; c0: number; c1: number; n: number }>();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = cellUf.find(id(r, c));
        const s = spans.get(k);
        if (!s) spans.set(k, { r0: r, r1: r, c0: c, c1: c, n: 1 });
        else {
          s.r0 = Math.min(s.r0, r);
          s.r1 = Math.max(s.r1, r);
          s.c0 = Math.min(s.c0, c);
          s.c1 = Math.max(s.c1, c);
          s.n++;
        }
      }
    }
    // A merged area that isn't a rectangle can't be expressed with spans: keep atomic cells.
    const cellsOf = (s: { r0: number; r1: number; c0: number; c1: number; n: number }) =>
      s.n === (s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1)
        ? [s]
        : Array.from({ length: (s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1) }, (_, k) => {
            const r = s.r0 + Math.floor(k / (s.c1 - s.c0 + 1));
            const c = s.c0 + (k % (s.c1 - s.c0 + 1));
            return { r0: r, r1: r, c0: c, c1: c, n: 1 };
          });
    const areas = [...spans.values()].flatMap(cellsOf);

    const cellRuns = new Map<(typeof areas)[number], TextRun[]>(areas.map((a) => [a, []]));
    for (const run of tableRuns) {
      const cx = run.x + run.width / 2;
      const cy = run.y + run.size * 0.3;
      const c = Math.max(0, Math.min(cols - 1, xs.findIndex((x, i) => i > 0 && cx <= x) - 1));
      const r = Math.max(0, Math.min(rows - 1, ys.findIndex((y, i) => i > 0 && cy >= y) - 1));
      const area = areas.find((a) => r >= a.r0 && r <= a.r1 && c >= a.c0 && c <= a.c1);
      if (area) cellRuns.get(area)!.push(run);
    }
    const cells: Cell[] = areas.map((a) => ({
      row: a.r0,
      col: a.c0,
      rowSpan: a.r1 - a.r0 + 1,
      colSpan: a.c1 - a.c0 + 1,
      lines: toLines(cellRuns.get(a)!, page),
    }));
    const filled = cells.filter((c) => c.lines.length);
    // A grid that holds text in only one cell is a frame around a text box, not a table.
    if (filled.length < 2) continue;

    const text = filled.flatMap((c) => c.lines.map((l) => l.text)).join(' ');
    const dir = letterDirection(text);
    const firstRow = cells.filter((c) => c.row === 0 && c.lines.length);
    const header = rows > 1 && firstRow.length > 0 && firstRow.every((c) => c.lines.every((l) => l.styled.flags.every((f, i) => f & 1 || l.styled.chars[i] === ' ')));
    tables.push({ box, rows, cols, cells, rtl: dir.rtl > dir.ltr, header });
    const used = new Set(tableRuns);
    rest = rest.filter((r) => !used.has(r));
  }
  return { tables, rest };
}

/* ------------------------------------------------------------------ borderless tables */

/** Pieces of a line separated by gaps much wider than a space: the line's cells. */
function segments(line: Line): TextRun[][] {
  const runs = [...line.runs].filter((r) => r.str.trim()).sort((a, b) => a.x - b.x);
  const out: TextRun[][] = [];
  const gapMin = Math.max(line.size * 1.6, 12);
  for (const r of runs) {
    const cur = out[out.length - 1];
    const last = cur?.[cur.length - 1];
    if (cur && last && r.x - (last.x + last.width) < gapMin) cur.push(r);
    else out.push([r]);
  }
  return out;
}

const span = (seg: TextRun[]) => ({ x0: Math.min(...seg.map((r) => r.x)), x1: Math.max(...seg.map((r) => r.x + r.width)) });
const segText = (seg: TextRun[]) => seg.map((r) => r.str).join('').trim();

/**
 * Runs of at least three consecutive lines that split into the same columns. Returns, for each
 * table found, the indexes of its first and last line, and the table itself.
 */
export function findAlignedTables(lines: Line[], page: number, textWidth: number): { from: number; to: number; table: Table }[] {
  const segs = lines.map(segments);
  const found: { from: number; to: number; table: Table }[] = [];
  const isRow = (i: number) => {
    const s = segs[i]!;
    if (s.length < 2) return false;
    const lens = s.map((g) => segText(g).length);
    // Table cells are short; two columns of running text are not a table.
    return Math.max(...lens) <= 60 && lens.reduce((a, b) => a + b, 0) / lens.length <= 32 && span(s.flat()).x1 - span(s.flat()).x0 > textWidth * 0.25;
  };

  let i = 0;
  while (i < lines.length) {
    if (!isRow(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < lines.length && isRow(j + 1) && lines[j]!.y - lines[j + 1]!.y > 0 && lines[j]!.y - lines[j + 1]!.y < lines[j]!.size * 2.8) j++;
    if (j - i + 1 >= 3) {
      const table = alignColumns(lines.slice(i, j + 1), segs.slice(i, j + 1), page);
      if (table) {
        found.push({ from: i, to: j, table });
        i = j + 1;
        continue;
      }
    }
    i = j + 1;
  }
  return found;
}

function alignColumns(rows: Line[], segs: TextRun[][][], page: number): Table | null {
  // Columns: x-ranges that overlap across rows are the same column.
  const cols: { x0: number; x1: number }[] = [];
  for (const row of segs) {
    for (const seg of row) {
      const s = span(seg);
      const hit = cols.filter((c) => s.x0 <= c.x1 && s.x1 >= c.x0);
      if (!hit.length) cols.push({ ...s });
      else {
        const merged = { x0: Math.min(s.x0, ...hit.map((c) => c.x0)), x1: Math.max(s.x1, ...hit.map((c) => c.x1)) };
        for (const h of hit) cols.splice(cols.indexOf(h), 1);
        cols.push(merged);
      }
    }
  }
  cols.sort((a, b) => a.x0 - b.x0);
  if (cols.length < 2) return null;

  // Every row must put each of its pieces in a different column.
  const assigned: TextRun[][][] = [];
  for (const row of segs) {
    const byCol: TextRun[][] = cols.map(() => []);
    for (const seg of row) {
      const s = span(seg);
      const c = cols.findIndex((col) => s.x0 <= col.x1 && s.x1 >= col.x0);
      if (c < 0 || byCol[c]!.length) return null;
      byCol[c] = seg;
    }
    assigned.push(byCol);
  }
  // Most columns must be used by most rows.
  const used = cols.map((_, c) => assigned.filter((r) => r[c]!.length).length);
  if (used.filter((n) => n >= rows.length * 0.6).length < 2) return null;

  const text = rows.map((l) => l.text).join(' ');
  const dir = letterDirection(text);
  const rtl = dir.rtl > dir.ltr;
  const cells: Cell[] = [];
  assigned.forEach((byCol, r) => {
    byCol.forEach((seg, c) => {
      const line = seg.length ? lineFromRuns(seg, page) : null;
      cells.push({ row: r, col: c, rowSpan: 1, colSpan: 1, lines: line ? [line] : [] });
    });
  });
  const first = cells.filter((c) => c.row === 0 && c.lines.length);
  const header = first.length > 0 && first.every((c) => c.lines[0]!.styled.flags.every((f, k) => f & 1 || c.lines[0]!.styled.chars[k] === ' '));
  const box = {
    x0: Math.min(...cols.map((c) => c.x0)),
    x1: Math.max(...cols.map((c) => c.x1)),
    y0: rows[rows.length - 1]!.y,
    y1: rows[0]!.y + rows[0]!.size,
  };
  return { box, rows: rows.length, cols: cols.length, cells, rtl, header };
}

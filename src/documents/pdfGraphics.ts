/**
 * What a PDF page draws besides text: ruling lines, filled boxes, pictures. pdf.js reports these
 * as an operator list; this walks it, tracks the transformation matrix, and keeps the geometry
 * (in the same coordinates as the text runs: PDF units, y grows upwards).
 *
 * Pure: the operator codes are passed in, so it runs without pdf.js in unit tests.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A horizontal or vertical line: table borders, underlines, separators. */
export interface Rule extends Box {
  horizontal: boolean;
}

export interface Shape extends Box {
  /** Filled with a visible (non-white) colour. */
  filled: boolean;
  stroked: boolean;
  /** Has curves (rounded corners, circles, arrows heads drawn with béziers). */
  curved: boolean;
}

export interface PageGraphics {
  rules: Rule[];
  shapes: Shape[];
  images: Box[];
  /** Text-drawing operations, visible and invisible (an OCR layer over a scan is invisible). */
  text: { visible: number; invisible: number };
}

export const EMPTY_GRAPHICS: PageGraphics = { rules: [], shapes: [], images: [], text: { visible: 0, invisible: 0 } };

/** The operator codes this module needs (pdf.js's OPS, or a test's own numbering). */
export interface OpCodes {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  fill: number;
  eoFill: number;
  stroke: number;
  closeStroke: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  closeEOFillStroke: number;
  setFillRGBColor: number;
  setLineWidth: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageMaskXObject: number;
  paintImageXObjectRepeat?: number;
  setTextRenderingMode?: number;
  showText?: number;
  showSpacedText?: number;
  nextLineShowText?: number;
  nextLineSetSpacingShowText?: number;
}

/** pdf.js's path drawing codes inside constructPath data. */
const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const QUAD = 3;
const CLOSE = 4;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function boxOf(m: Matrix, x0: number, y0: number, x1: number, y1: number): Box {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const isWhite = (color: unknown) => typeof color === 'string' && /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/i.test(color);

/** Thinner than this (PDF units) and a filled rectangle is a line, not a box. */
const THIN = 2.5;

export function analyzeOperators(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, OPS: OpCodes): PageGraphics {
  const rules: Rule[] = [];
  const shapes: Shape[] = [];
  const images: Box[] = [];
  let ctm: Matrix = IDENTITY;
  let fillColor: unknown = '#000000';
  let lineWidth = 1;
  let textMode = 0;
  const text = { visible: 0, invisible: 0 };
  const stack: { ctm: Matrix; fillColor: unknown; lineWidth: number; textMode: number }[] = [];

  const strokeOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const fillOps = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat ?? -1]);
  const textOps = new Set([OPS.showText ?? -1, OPS.showSpacedText ?? -1, OPS.nextLineShowText ?? -1, OPS.nextLineSetSpacingShowText ?? -1]);

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]!;
    const args = argsArray[i] as unknown[] | null;
    if (fn === OPS.save) {
      stack.push({ ctm, fillColor, lineWidth, textMode });
    } else if (fn === OPS.restore) {
      const s = stack.pop();
      if (s) ({ ctm, fillColor, lineWidth, textMode } = s);
    } else if (fn === OPS.transform && args) {
      ctm = multiply(ctm, args.slice(0, 6) as Matrix);
    } else if (fn === OPS.paintFormXObjectBegin && args) {
      stack.push({ ctm, fillColor, lineWidth, textMode });
      const m = args[0] as number[] | null;
      if (m && m.length === 6) ctm = multiply(ctm, m as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) {
      const s = stack.pop();
      if (s) ({ ctm, fillColor, lineWidth, textMode } = s);
    } else if (fn === OPS.setFillRGBColor && args) {
      fillColor = args[0];
    } else if (fn === OPS.setLineWidth && args) {
      lineWidth = Number(args[0]) || 0;
    } else if (fn === OPS.setTextRenderingMode && args) {
      textMode = Number(args[0]) || 0;
    } else if (textOps.has(fn)) {
      // Mode 3 draws nothing (and 7 only clips): text that is there to be found, not seen.
      if ((textMode & 3) === 3) text.invisible++;
      else text.visible++;
    } else if (imageOps.has(fn)) {
      // Images are drawn into the unit square of the current matrix.
      const b = boxOf(ctm, 0, 0, 1, 1);
      if (b.x1 - b.x0 > 1 && b.y1 - b.y0 > 1) images.push(b);
    } else if (fn === OPS.constructPath && args) {
      const paint = args[0] as number;
      const stroked = strokeOps.has(paint);
      const filled = fillOps.has(paint) && !isWhite(fillColor);
      if (!stroked && !filled) continue; // clipping paths and invisible fills
      const data = (args[1] as (ArrayLike<number> | null)[] | null)?.[0];
      if (data) addPath(data, ctm, stroked, filled, lineWidth, rules, shapes);
    }
  }
  return { rules, shapes, images, text };
}

function addPath(data: ArrayLike<number>, ctm: Matrix, stroked: boolean, filled: boolean, lineWidth: number, rules: Rule[], shapes: Shape[]) {
  // Split into subpaths; keep each one's points (transformed) and whether it curves.
  const subpaths: { pts: [number, number][]; curved: boolean }[] = [];
  let cur: { pts: [number, number][]; curved: boolean } | null = null;
  for (let k = 0; k < data.length; ) {
    const op = data[k++];
    if (op === MOVE) {
      cur = { pts: [apply(ctm, data[k]!, data[k + 1]!)], curved: false };
      subpaths.push(cur);
      k += 2;
    } else if (op === LINE) {
      cur?.pts.push(apply(ctm, data[k]!, data[k + 1]!));
      k += 2;
    } else if (op === CURVE) {
      if (cur) {
        cur.curved = true;
        cur.pts.push(apply(ctm, data[k + 4]!, data[k + 5]!));
      }
      k += 6;
    } else if (op === QUAD) {
      if (cur) {
        cur.curved = true;
        cur.pts.push(apply(ctm, data[k + 2]!, data[k + 3]!));
      }
      k += 4;
    } else if (op === CLOSE) {
      if (cur && cur.pts.length) cur.pts.push(cur.pts[0]!);
    } else {
      break; // unknown code: stop rather than misread the rest
    }
  }

  // Stroke width in page units (the matrix may scale it).
  const scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;
  const width = Math.max(lineWidth * scale, 0.1);

  for (const sp of subpaths) {
    if (sp.pts.length < 2) continue;
    const xs = sp.pts.map((p) => p[0]);
    const ys = sp.pts.map((p) => p[1]);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;

    // A filled sliver is a line (many producers draw table borders this way).
    if (filled && !sp.curved && (w < THIN || h < THIN) && Math.max(w, h) > THIN * 2) {
      rules.push(w >= h ? { x0: box.x0, x1: box.x1, y0: (box.y0 + box.y1) / 2, y1: (box.y0 + box.y1) / 2, horizontal: true } : { x0: (box.x0 + box.x1) / 2, x1: (box.x0 + box.x1) / 2, y0: box.y0, y1: box.y1, horizontal: false });
      continue;
    }
    if (stroked && !sp.curved && width < 4) {
      // Each straight, axis-aligned edge of a stroked path is a rule.
      for (let j = 1; j < sp.pts.length; j++) {
        const [ax, ay] = sp.pts[j - 1]!;
        const [bx, by] = sp.pts[j]!;
        if (Math.abs(ay - by) < 0.5 && Math.abs(ax - bx) > 1) rules.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: ay, y1: ay, horizontal: true });
        else if (Math.abs(ax - bx) < 0.5 && Math.abs(ay - by) > 1) rules.push({ x0: ax, x1: ax, y0: Math.min(ay, by), y1: Math.max(ay, by), horizontal: false });
      }
      if (!filled) {
        if (w > 1 && h > 1) shapes.push({ ...box, filled: false, stroked: true, curved: false });
        continue;
      }
    }
    if (w > 0.5 && h > 0.5) shapes.push({ ...box, filled, stroked, curved: sp.curved });
  }
}

/* ------------------------------------------------------------------ geometry helpers */

export const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

export const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

export const contains = (outer: Box, x: number, y: number, pad = 0) => x >= outer.x0 - pad && x <= outer.x1 + pad && y >= outer.y0 - pad && y <= outer.y1 + pad;

export const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });

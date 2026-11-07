/**
 * One pdf.js page → what pdfLayout needs: text runs (with bold/italic/monospace from the font),
 * the page's drawings, and its visible area. Takes pdf.js objects as arguments instead of
 * importing pdf.js, so the same code runs in the extension and in Node test scripts.
 */
import { analyzeOperators, type OpCodes } from './pdfGraphics';
import type { PageText } from './pdfLayout';
import type { TextRun } from './pdfText';

/** The parts of a pdf.js PDFPageProxy used here. */
export interface PdfPageLike {
  view: number[];
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getTextContent(params?: { includeMarkedContent?: boolean; disableNormalization?: boolean }): Promise<{ items: unknown[] }>;
  commonObjs: { has(id: string): boolean; get(id: string): unknown };
}

interface FontLike {
  name?: string;
  loadedName?: string;
  bold?: boolean;
  black?: boolean;
  italic?: boolean;
  isMonospace?: boolean;
}

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
  fontName: string;
}

const BOLD_NAME = /bold|black|heavy|semibold|demi|extrabold|ultrabold|,b$|-b$/i;
const ITALIC_NAME = /italic|oblique|slanted|,i$|-i$/i;
const MONO_NAME = /mono|courier|consol|menlo|code|typewriter|inconsolata/i;

export async function extractPage(page: PdfPageLike, OPS: OpCodes): Promise<PageText> {
  // The operator list first: it also loads the page's fonts, whose names say bold or italic.
  let graphics: PageText['graphics'];
  try {
    const ops = await page.getOperatorList();
    graphics = analyzeOperators(ops.fnArray, ops.argsArray, OPS);
  } catch {
    graphics = undefined; // drawings are a bonus; the text still works without them
  }

  // Normalization happens per glyph in the patched worker, and in pdfText's normalizeForms.
  const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: true });
  const fonts = new Map<string, { bold: boolean; italic: boolean; mono: boolean }>();
  const fontStyle = (id: string) => {
    let f = fonts.get(id);
    if (f) return f;
    let font: FontLike | null = null;
    try {
      if (page.commonObjs.has(id)) font = page.commonObjs.get(id) as FontLike;
    } catch {
      font = null;
    }
    const name = font?.name ?? '';
    f = {
      bold: !!font?.bold || !!font?.black || BOLD_NAME.test(name),
      italic: !!font?.italic || ITALIC_NAME.test(name),
      mono: !!font?.isMonospace || MONO_NAME.test(name),
    };
    fonts.set(id, f);
    return f;
  };

  const runs: TextRun[] = [];
  for (const raw of content.items) {
    if (!raw || typeof raw !== 'object' || !('str' in raw)) continue;
    const item = raw as TextItemLike;
    const [a, b, c, d, x, y] = item.transform;
    const style = fontStyle(item.fontName);
    runs.push({
      str: item.str,
      x: x!,
      y: y!,
      width: item.width,
      size: Math.hypot(c!, d!) || Math.hypot(a!, b!) || item.height,
      eol: item.hasEOL,
      ...(style.bold && { bold: true }),
      ...(style.italic && { italic: true }),
      ...(style.mono && { mono: true }),
    });
  }
  const [x0 = 0, y0 = 0, x1 = 612, y1 = 792] = page.view;
  const t = graphics?.text;
  return {
    runs,
    graphics,
    view: [x0, y0, x1, y1],
    invisibleText: t && t.visible + t.invisible > 0 ? t.invisible / (t.visible + t.invisible) : 0,
  };
}

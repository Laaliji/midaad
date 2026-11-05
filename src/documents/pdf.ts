/**
 * PDF → reflowed HTML with pdf.js. Only the text layer is used: the reader re-flows it into
 * comfortable paragraphs (see pdfLayout.ts). pdf.js runs in its own worker and never executes
 * scripts embedded in the PDF.
 */
import { getDocument, GlobalWorkerOptions, PasswordResponses, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { DocumentError } from './detect';
import { layoutPages, type PageText, type TextRun } from './pdfLayout';
import type { ParsedDocument, ParseOptions } from './types';

GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = '/pdfjs/';

export async function parsePdf(bytes: Uint8Array, opts: ParseOptions = {}): Promise<ParsedDocument> {
  const task = getDocument({
    data: bytes.slice(), // pdf.js transfers (detaches) the buffer it's given
    password: opts.password,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
  });

  let pdf: PDFDocumentProxy;
  try {
    pdf = await task.promise;
  } catch (err) {
    const e = err as { name?: string; code?: number };
    if (e?.name === 'PasswordException') {
      throw e.code === PasswordResponses.INCORRECT_PASSWORD
        ? new DocumentError('wrong-password', 'That password didn’t work. Try again.')
        : new DocumentError('password', 'This PDF is protected by a password.');
    }
    throw new DocumentError('corrupt', 'This PDF looks damaged and can’t be opened.');
  }

  try {
    const total = pdf.numPages;
    const pages: PageText[] = [];
    for (let n = 1; n <= total; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
      const runs: TextRun[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const [a, b, c, d, x, y] = item.transform as number[];
        runs.push({
          str: item.str,
          x: x!,
          y: y!,
          width: item.width,
          size: Math.hypot(c!, d!) || Math.hypot(a!, b!) || item.height,
          eol: item.hasEOL,
        });
      }
      pages.push({ runs });
      page.cleanup();
      opts.onProgress?.(n, total);
      if (n % 8 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
    }

    const { html, chars } = layoutPages(pages);
    if (chars < Math.max(40, total * 25)) {
      throw new DocumentError(
        'scanned',
        'This PDF contains images of pages, not text, so there’s nothing to read aloud or highlight.',
        'It was probably scanned. Run it through OCR (for example “Make searchable” in Acrobat, or OCRmyPDF), then open the result.',
      );
    }

    const meta = await pdf.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Title?: string; Author?: string; Language?: string };
    return {
      kind: 'pdf',
      title: cleanTitle(info.Title),
      author: info.Author?.trim() || null,
      lang: info.Language?.trim() || null,
      dir: null,
      html,
      pages: total,
    };
  } finally {
    void task.destroy();
  }
}

/** Many PDFs carry a useless title ("Microsoft Word - draft3.docx", "untitled"). */
function cleanTitle(t: string | undefined): string | null {
  const s = t?.trim();
  if (!s || s.length < 3) return null;
  if (/^(untitled|microsoft word|document[0-9]*$|slide [0-9])/i.test(s) || /[.](docx?|pdf|tex|indd|odt)$/i.test(s)) return null;
  return s;
}

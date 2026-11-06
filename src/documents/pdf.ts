/**
 * PDF → reflowed HTML with pdf.js. Only the text layer is used: the reader re-flows it into
 * comfortable paragraphs (see pdfLayout.ts). pdf.js runs in its own worker and never executes
 * scripts embedded in the PDF.
 */
import { getDocument, GlobalWorkerOptions, OPS, PasswordResponses, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DocumentError } from './detect';
import { extractPage, type PdfPageLike } from './pdfExtract';
import type { OpCodes } from './pdfGraphics';
import { layoutPages, type PageText } from './pdfLayout';
import type { ParsedDocument, ParseOptions } from './types';

const ASSETS = '/pdfjs/';

// A patched copy of the worker, written by scripts/copy-pdfjs.mjs (it fixes Arabic ligatures).
GlobalWorkerOptions.workerSrc = `${ASSETS}pdf.worker.min.mjs`;

/**
 * Open a PDF with pdf.js, fully offline. `forDrawing` lets pdf.js load the PDF's own fonts as web
 * fonts, so figures drawn from the file look right; text extraction doesn't need them.
 */
export function openPdf(bytes: Uint8Array, opts: { password?: string; forDrawing?: boolean } = {}) {
  return getDocument({
    data: bytes.slice(), // pdf.js transfers (detaches) the buffer it's given
    password: opts.password,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    enableXfa: false,
    disableFontFace: !opts.forDrawing,
    useSystemFonts: false,
    stopAtErrors: false,
  });
}

export async function parsePdf(bytes: Uint8Array, opts: ParseOptions = {}): Promise<ParsedDocument> {
  const task = openPdf(bytes, { password: opts.password });

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
      pages.push(await extractPage(page as unknown as PdfPageLike, OPS as unknown as OpCodes));
      page.cleanup();
      opts.onProgress?.(n, total);
      if (n % 4 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
    }

    const { html, chars, scannedPages, figures } = layoutPages(pages);
    if (chars < 20 && !figures) {
      throw new DocumentError('empty', 'This PDF has no text or pictures that Midaad can show.');
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
      scanned: scannedPages > 0 ? (scannedPages === total ? 'all' : 'some') : undefined,
      file: figures > 0 ? bytes : undefined,
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

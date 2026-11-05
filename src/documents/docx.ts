/**
 * Word (.docx) → HTML with mammoth: headings, paragraphs, lists, tables, footnotes and images.
 * Word's visual formatting (fonts, colours, exact spacing) is deliberately dropped; the reader
 * applies its own typography.
 */
import mammoth from 'mammoth/mammoth.browser.min.js';
import { strFromU8, unzipSync } from 'fflate';
import { DocumentError } from './detect';
import type { ParsedDocument } from './types';

export async function parseDocx(bytes: Uint8Array): Promise<ParsedDocument> {
  let html: string;
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const result = await mammoth.convertToHtml(
      { arrayBuffer: buffer },
      {
        // Common title/subtitle styles in Word, plus Arabic-localized Word's built-in names.
        styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='عنوان'] => h1:fresh"],
      },
    );
    html = result.value;
  } catch {
    throw new DocumentError('corrupt', 'This Word document looks damaged and can’t be opened.');
  }

  const core = readCore(bytes);
  if (!html.trim()) throw new DocumentError('empty', 'This Word document has no text.');
  return { kind: 'docx', title: core.title, author: core.author, lang: core.lang, dir: core.rtl ? 'rtl' : null, html };
}

/** Title, author and language from docProps/core.xml and word/settings.xml. */
function readCore(bytes: Uint8Array): { title: string | null; author: string | null; lang: string | null; rtl: boolean } {
  const out = { title: null as string | null, author: null as string | null, lang: null as string | null, rtl: false };
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'docProps/core.xml' || f.name === 'word/document.xml' });
    const core = files['docProps/core.xml'];
    if (core) {
      const doc = new DOMParser().parseFromString(strFromU8(core), 'application/xml');
      const get = (tag: string) => doc.getElementsByTagNameNS('*', tag)[0]?.textContent?.trim() || null;
      out.title = get('title');
      out.author = get('creator');
      out.lang = get('language');
    }
    // mammoth drops paragraph direction. If most paragraphs are marked right-to-left, say so.
    const body = files['word/document.xml'];
    if (body) {
      const xml = strFromU8(body);
      const paragraphs = xml.split('<w:p>').length + xml.split('<w:p ').length - 2;
      const bidi = xml.split('<w:bidi/>').length + xml.split('<w:bidi ').length - 2;
      out.rtl = paragraphs > 0 && bidi / paragraphs > 0.5;
    }
  } catch {
    /* metadata is optional */
  }
  return out;
}

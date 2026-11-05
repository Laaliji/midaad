/**
 * Recognize a file by its content (not just its extension), and decode text files whatever
 * their encoding: UTF-8, UTF-16, or older Arabic/Western Windows code pages.
 */
import { unzipSync } from 'fflate';
import type { DocumentKind } from '../shared/documents';

export type DocumentErrorCode =
  | 'unsupported'
  | 'legacy-doc'
  | 'drm'
  | 'scanned'
  | 'password'
  | 'wrong-password'
  | 'corrupt'
  | 'empty'
  | 'too-large'
  | 'network';

/** A problem the reader should understand and can often fix. `message` is shown as is. */
export class DocumentError extends Error {
  constructor(
    public code: DocumentErrorCode,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = 'DocumentError';
  }
}

export const MAX_FILE_SIZE = 300 * 1024 * 1024;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

export function detectKind(bytes: Uint8Array, fileName: string): DocumentKind {
  if (!bytes.length) throw new DocumentError('empty', 'This file is empty.');
  if (bytes.length > MAX_FILE_SIZE) {
    throw new DocumentError('too-large', 'This file is too large to open (over 300 MB).');
  }

  // %PDF can appear after a little junk at the start of the file.
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  if (head.includes('%PDF-')) return 'pdf';

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const names: string[] = [];
    try {
      unzipSync(bytes, {
        filter: (f) => {
          names.push(f.name);
          return false; // only list the entries, don't decompress anything
        },
      });
    } catch {
      throw new DocumentError('corrupt', 'This file looks damaged and can’t be opened.');
    }
    const has = (n: string) => names.includes(n);
    if (has('META-INF/container.xml')) return 'epub';
    if (has('word/document.xml')) return 'docx';
    if (names.some((n) => n.startsWith('xl/'))) throw unsupported('Excel spreadsheets');
    if (names.some((n) => n.startsWith('ppt/'))) throw unsupported('PowerPoint presentations');
    if (has('content.xml')) {
      throw new DocumentError(
        'unsupported',
        'OpenDocument files (.odt) aren’t supported yet.',
        'Open it in LibreOffice or Word and save it as .docx or PDF.',
      );
    }
    throw unsupported('This kind of ZIP file');
  }

  // Old binary Word / Office files (OLE container).
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new DocumentError(
      'legacy-doc',
      'Old Word files (.doc) aren’t supported.',
      'Open it in Word, LibreOffice or Google Docs and save it as .docx or PDF, then open that.',
    );
  }

  const e = ext(fileName);
  if (['html', 'htm', 'xhtml', 'xht'].includes(e)) return 'html';
  if (['mobi', 'azw', 'azw3', 'kfx'].includes(e)) {
    throw new DocumentError(
      'unsupported',
      'Kindle books (.mobi, .azw) aren’t supported.',
      'If the book has no DRM, convert it to EPUB with Calibre, then open the EPUB.',
    );
  }
  if (['rtf'].includes(e)) throw unsupported('RTF documents', 'Save it as .docx or PDF, then open that.');
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'tif', 'tiff', 'bmp'].includes(e)) {
    throw new DocumentError('unsupported', 'Images can’t be read as text yet.', 'Midaad needs a document with real text: PDF, EPUB, Word or text.');
  }
  if (looksLikeText(bytes)) return /<html[ >]|<body[ >]|<!doctype html/i.test(head) ? 'html' : 'txt';
  throw unsupported('This file type');
}

function unsupported(what: string, hint = 'Midaad opens PDF, EPUB, Word (.docx), text and HTML files.'): DocumentError {
  return new DocumentError('unsupported', `${what} can’t be opened.`, hint);
}

/** No NUL bytes in the first 8 KB (UTF-16 files are caught by their BOM first). */
function looksLikeText(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return true;
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return false;
  return true;
}

/** Decode text, detecting the encoding: BOM, then strict UTF-8, then a legacy code page. */
export function decodeText(bytes: Uint8Array): string {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (startsWith(bytes, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (startsWith(bytes, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Not UTF-8. Older Arabic files are usually Windows-1256; Western ones Windows-1252.
    const arabic = new TextDecoder('windows-1256').decode(bytes);
    let letters = 0;
    let arabicLetters = 0;
    for (let i = 0; i < arabic.length && i < 20000; i++) {
      const c = arabic.charCodeAt(i);
      if (c < 0x80) continue;
      letters++;
      if (c >= 0x0600 && c <= 0x06ff) arabicLetters++;
    }
    return letters && arabicLetters / letters > 0.6 ? arabic : new TextDecoder('windows-1252').decode(bytes);
  }
}

export function baseName(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf(String.fromCharCode(92)));
  const name = fileName.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).replace(/[_]+/g, ' ').trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

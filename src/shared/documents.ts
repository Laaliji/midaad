/**
 * Documents opened from files (PDF, EPUB, Word, text, HTML) in the Library.
 */

export type DocumentKind = 'pdf' | 'epub' | 'docx' | 'txt' | 'html';

export const KIND_LABELS: Record<DocumentKind, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  docx: 'Word',
  txt: 'Text',
  html: 'HTML',
};

export interface DocumentRecord {
  /** `doc:` + SHA-256 of the file. The same file always gets the same key, so its highlights come back. */
  key: string;
  kind: DocumentKind;
  fileName: string;
  title: string;
  author: string | null;
  lang?: string;
  dir: 'ltr' | 'rtl';
  words: number;
  minutes: number;
  size: number;
  pages?: number;
  /** PDFs: some or all pages are scans, shown as pictures. */
  scanned?: 'some' | 'all';
  addedAt: number;
  openedAt: number;
  /** Reading position, 0..1. */
  progress: number;
}

export interface DocumentContent {
  key: string;
  /** Sanitized HTML of the converted document. */
  html: string;
  /** PDFs with figures: the original file, which the figures are drawn from. */
  file?: Uint8Array;
}

export const DOC_PREFIX = 'doc:';

export function isDocumentKey(url: string): boolean {
  return url.startsWith(DOC_PREFIX);
}

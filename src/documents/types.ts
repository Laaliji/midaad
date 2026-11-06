import type { DocumentKind } from '../shared/documents';

/** What every parser returns: unsanitized HTML plus whatever metadata the file declares. */
export interface ParsedDocument {
  kind: DocumentKind;
  title: string | null;
  author: string | null;
  lang: string | null;
  dir: 'ltr' | 'rtl' | null;
  html: string;
  pages?: number;
  /** PDFs: some or all pages are scans, shown as pictures. */
  scanned?: 'some' | 'all';
  /**
   * PDFs with figures: the original file, kept so figures (and scanned pages) can be drawn from
   * it when the document is read.
   */
  file?: Uint8Array;
}

export interface ParseOptions {
  password?: string;
  onProgress?: (done: number, total: number) => void;
}

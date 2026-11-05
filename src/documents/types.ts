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
}

export interface ParseOptions {
  password?: string;
  onProgress?: (done: number, total: number) => void;
}

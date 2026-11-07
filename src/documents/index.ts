/**
 * File → readable article: detect the format, convert it to HTML, sanitize, and work out title,
 * language and direction. Also stores documents so they can be reopened from the Library.
 */
import { buildArticle, extractArticle, sanitizeToFragment, type Article } from '../content/reader/extract';
import { db } from '../shared/db';
import { DOC_PREFIX, type DocumentKind, type DocumentRecord } from '../shared/documents';
import { baseName, detectKind, DocumentError } from './detect';
import { parseEpub } from './epub';
import { parseText, parseHtmlFile } from './text';
import type { ParsedDocument, ParseOptions } from './types';

export { DocumentError } from './detect';

export interface OpenedDocument {
  record: DocumentRecord;
  article: Article;
  /** PDFs with figures: the original file, which the figures are drawn from. */
  file?: Uint8Array;
}

export async function documentKey(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return DOC_PREFIX + Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Convert a file. Throws DocumentError with a readable message for anything we can't open. */
export async function convertFile(bytes: Uint8Array, fileName: string, opts: ParseOptions = {}): Promise<OpenedDocument> {
  const kind = detectKind(bytes, fileName);
  const key = await documentKey(bytes);

  let parsed: ParsedDocument;
  let article: Article | null = null;
  switch (kind) {
    case 'pdf': {
      const { parsePdf } = await import('./pdf'); // pdf.js is large; load it only when needed
      parsed = await parsePdf(bytes, opts);
      break;
    }
    case 'epub':
      parsed = parseEpub(bytes);
      break;
    case 'docx': {
      const { parseDocx } = await import('./docx');
      parsed = await parseDocx(bytes);
      break;
    }
    case 'html': {
      const { doc } = parseHtmlFile(bytes);
      article = extractArticle(doc, key);
      parsed = {
        kind: 'html',
        title: article?.title || doc.title || null,
        author: article?.byline ?? null,
        lang: article?.lang ?? doc.documentElement.lang ?? null,
        dir: null,
        html: article ? '' : (doc.body?.innerHTML ?? ''),
      };
      break;
    }
    default:
      parsed = parseText(bytes);
  }

  const now = Date.now();
  if (article) {
    // Readability already sanitized and tidied it.
    article = { ...article, url: key, siteName: fileName, kind: 'html' };
  } else {
    article = toArticle(parsed, key, fileName);
  }
  // A scanned PDF can have no text at all, only pictures of its pages.
  const hasFigures = !!parsed.file && !!article.content.querySelector('[data-pdf-figure]');
  if (!article.textContent.trim() && !hasFigures) throw new DocumentError('empty', 'This file has no readable text.');

  const record: DocumentRecord = {
    key,
    kind,
    fileName,
    title: article.title,
    author: article.byline,
    lang: article.lang,
    dir: article.dir,
    words: article.words,
    minutes: article.minutes,
    size: bytes.length,
    pages: parsed.pages,
    ...(parsed.scanned && { scanned: parsed.scanned }),
    addedAt: now,
    openedAt: now,
    progress: 0,
  };
  return { record, article, file: hasFigures ? parsed.file : undefined };
}

function toArticle(parsed: ParsedDocument, key: string, fileName: string): Article {
  const content = sanitizeToFragment(parsed.html);
  prepareContent(content);

  // Title: the file's metadata, else its first heading, else the file name.
  const firstHeading = content.querySelector('h1, h2');
  const headingText = firstHeading?.textContent?.trim() ?? '';
  let title = parsed.title?.trim() || '';
  if (!title && headingText && headingText.length < 200) title = headingText;
  if (!title) title = baseName(fileName);
  if (firstHeading && headingText.toLowerCase() === title.toLowerCase()) firstHeading.remove();

  return buildArticle({
    url: key,
    title,
    byline: parsed.author,
    siteName: fileName,
    publishedTime: null,
    lang: parsed.lang,
    declaredDir: parsed.dir,
    content,
    kind: parsed.kind as DocumentKind,
  });
}

/**
 * Per-paragraph direction (documents often mix Arabic and Latin paragraphs), scrollable tables,
 * and no empty paragraphs.
 */
function prepareContent(content: DocumentFragment) {
  content.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, figcaption, dt, dd').forEach((el) => {
    if (!el.hasAttribute('dir')) el.setAttribute('dir', 'auto');
  });
  content.querySelectorAll('table').forEach((table) => {
    const wrap = document.createElement('div');
    wrap.className = 'mw-table';
    table.replaceWith(wrap);
    wrap.append(table);
  });
  content.querySelectorAll('p').forEach((p) => {
    if (!p.textContent?.trim() && !p.querySelector('img, [data-page]')) p.remove();
  });
}

/* ------------------------------------------------------------------ storage */

function serialize(fragment: DocumentFragment): string {
  const div = document.createElement('div');
  div.append(fragment.cloneNode(true));
  return div.innerHTML;
}

export async function saveDocument(doc: OpenedDocument): Promise<DocumentRecord> {
  const d = await db();
  const existing = await d.get('documents', doc.record.key);
  const record: DocumentRecord = existing
    ? { ...doc.record, addedAt: existing.addedAt, progress: existing.progress, openedAt: Date.now() }
    : doc.record;
  const tx = d.transaction(['documents', 'documentContent'], 'readwrite');
  await Promise.all([
    tx.objectStore('documents').put(record),
    tx.objectStore('documentContent').put({ key: record.key, html: serialize(doc.article.content), ...(doc.file && { file: doc.file }) }),
    tx.done,
  ]);
  return record;
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const all = await (await db()).getAllFromIndex('documents', 'openedAt');
  return all.reverse();
}

/** Reopen a stored document. Its HTML is sanitized again on the way in, as a second line of defence. */
export async function loadDocument(key: string): Promise<OpenedDocument | null> {
  const d = await db();
  const [record, content] = await Promise.all([d.get('documents', key), d.get('documentContent', key)]);
  if (!record || !content) return null;
  record.openedAt = Date.now();
  await d.put('documents', record);
  const article = buildArticle({
    url: key,
    title: record.title,
    byline: record.author,
    siteName: record.fileName,
    publishedTime: null,
    lang: record.lang,
    declaredDir: record.dir,
    content: sanitizeToFragment(content.html),
    kind: record.kind,
  });
  return { record, article, file: content.file };
}

export async function saveProgress(key: string, progress: number): Promise<void> {
  const d = await db();
  const tx = d.transaction('documents', 'readwrite');
  const record = await tx.store.get(key);
  if (record) {
    record.progress = Math.min(1, Math.max(0, progress));
    await tx.store.put(record);
  }
  await tx.done;
}

/** Remove a document from the Library. Its highlights stay, and return if the file is opened again. */
export async function deleteDocument(key: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['documents', 'documentContent'], 'readwrite');
  await Promise.all([tx.objectStore('documents').delete(key), tx.objectStore('documentContent').delete(key), tx.done]);
}

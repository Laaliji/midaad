/**
 * Plain text (and light Markdown) → HTML, and standalone HTML files → article.
 */
import { decodeText, escapeHtml } from './detect';
import type { ParsedDocument } from './types';

const LIST_ITEM = /^([-*•–] |[0-9]+[.)] )/;

export function parseText(bytes: Uint8Array): ParsedDocument {
  const text = decodeText(bytes);
  const lines = text.split(String.fromCharCode(10)).map((l) => (l.endsWith(String.fromCharCode(13)) ? l.slice(0, -1) : l));

  const blocks: string[] = [];
  let para: string[] = [];
  // A short first line standing on its own is very likely the title.
  const firstIdx = lines.findIndex((l) => l.trim());
  const first = firstIdx >= 0 ? lines[firstIdx]!.trim().replace(/^#+ +/, '') : '';
  let title: string | null = first && first.length < 100 && !lines[firstIdx + 1]?.trim() ? first : null;
  const flush = () => {
    if (para.length) blocks.push(`<p>${escapeHtml(para.join(' '))}</p>`);
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,6}) +(.+)$/.exec(line);
    if (heading) {
      flush();
      const level = Math.min(4, heading[1]!.length + 1);
      title ??= heading[2]!;
      blocks.push(`<h${level}>${escapeHtml(heading[2]!)}</h${level}>`);
    } else if (LIST_ITEM.test(line)) {
      flush();
      blocks.push(`<p>${escapeHtml(line)}</p>`);
    } else {
      para.push(line);
    }
  }
  flush();

  return { kind: 'txt', title, author: null, lang: null, dir: null, html: blocks.join('\n') };
}

export function parseHtmlFile(bytes: Uint8Array): { doc: Document } {
  return { doc: new DOMParser().parseFromString(decodeText(bytes), 'text/html') };
}

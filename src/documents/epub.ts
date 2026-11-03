/**
 * EPUB 2/3 → one HTML document, chapter by chapter in reading order (the spine).
 * Images become data: URLs so the book can be stored and reopened offline; links between
 * chapters are rewritten to in-document anchors. The result is sanitized by the caller.
 */
import { strFromU8, unzipSync } from 'fflate';
import { DocumentError } from './detect';
import type { ParsedDocument } from './types';

const FONT_EXT = /[.](ttf|otf|woff2?|eot)$/i;
const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'];

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
};

export function parseEpub(bytes: Uint8Array): ParsedDocument {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new DocumentError('corrupt', 'This EPUB looks damaged and can’t be opened.');
  }
  const read = (path: string): string | null => {
    const f = files[path] ?? files[decodeURIComponentSafe(path)];
    return f ? strFromU8(f) : null;
  };

  checkDrm(files, read);

  const container = xml(read('META-INF/container.xml'));
  const opfPath = container?.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  const opf = opfPath ? xml(read(opfPath)) : null;
  if (!opfPath || !opf) throw new DocumentError('corrupt', 'This EPUB is missing its table of contents and can’t be opened.');
  const opfDir = dirname(opfPath);

  const meta = (tag: string) =>
    Array.from(opf.getElementsByTagNameNS('*', tag))
      .map((e) => e.textContent?.trim() ?? '')
      .filter(Boolean);

  // manifest: id → { path, type }
  const manifest = new Map<string, { path: string; type: string; props: string }>();
  for (const item of Array.from(opf.getElementsByTagNameNS('*', 'item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      manifest.set(id, {
        path: join(opfDir, href),
        type: item.getAttribute('media-type') ?? '',
        props: item.getAttribute('properties') ?? '',
      });
    }
  }

  const spineEl = opf.getElementsByTagNameNS('*', 'spine')[0];
  const refs = Array.from(opf.getElementsByTagNameNS('*', 'itemref'));
  const spine = refs
    .filter((r) => r.getAttribute('linear') !== 'no')
    .map((r) => manifest.get(r.getAttribute('idref') ?? ''))
    .filter((m): m is { path: string; type: string; props: string } => !!m && /html|xml/.test(m.type))
    .map((m) => m.path);
  if (!spine.length) throw new DocumentError('empty', 'This EPUB has no readable chapters.');

  const chapterIndex = new Map(spine.map((p, i) => [p, i]));
  const imageCache = new Map<string, string | null>();
  const dataUrl = (path: string): string | null => {
    if (imageCache.has(path)) return imageCache.get(path)!;
    const f = files[path] ?? files[decodeURIComponentSafe(path)];
    const mime = MIME[path.split('.').pop()?.toLowerCase() ?? ''];
    const url = f && mime ? `data:${mime};base64,${toBase64(f)}` : null;
    imageCache.set(path, url);
    return url;
  };

  const sections: string[] = [];
  spine.forEach((path, n) => {
    const src = read(path);
    if (!src) return;
    const doc = parseChapter(src);
    const body = doc.body ?? doc.getElementsByTagName('body')[0];
    if (!body) return;
    const dir = dirname(path);
    const prefix = `c${n}`;

    // SVG cover pages: <svg><image href="cover.jpg"/></svg> → <img>
    for (const svg of Array.from(body.getElementsByTagName('svg'))) {
      const image = svg.getElementsByTagName('image')[0];
      const href = image?.getAttribute('href') ?? image?.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (!href) continue;
      const img = body.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'img');
      img.setAttribute('src', href);
      img.setAttribute('alt', '');
      svg.replaceWith(img);
    }
    for (const img of Array.from(body.getElementsByTagName('img'))) {
      const s = img.getAttribute('src');
      const url = s && !/^(data|https?):/i.test(s) ? dataUrl(join(dir, s)) : s;
      if (url) img.setAttribute('src', url);
      else img.remove();
    }
    for (const el of Array.from(body.querySelectorAll('[id]'))) el.setAttribute('id', `${prefix}-${el.getAttribute('id')}`);
    for (const a of Array.from(body.getElementsByTagName('a'))) {
      const href = a.getAttribute('href');
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // external links stay as they are
      const [file, frag] = href.split('#');
      const target = file ? chapterIndex.get(join(dir, file)) : n;
      if (target === undefined) a.removeAttribute('href');
      else a.setAttribute('href', frag ? `#c${target}-${frag}` : `#c${target}`);
    }

    const html = serializeChildren(body);
    if (html.trim()) sections.push(`<section id="${prefix}">${html}</section>`);
  });

  const progression = spineEl?.getAttribute('page-progression-direction');
  return {
    kind: 'epub',
    title: meta('title')[0] ?? null,
    author: meta('creator').join(', ') || null,
    lang: meta('language')[0] ?? null,
    dir: progression === 'rtl' || progression === 'ltr' ? progression : null,
    html: sections.join('\n'),
  };
}

/** Adobe/Readium/Apple DRM encrypts the chapters themselves. Font obfuscation is harmless. */
function checkDrm(files: Record<string, Uint8Array>, read: (p: string) => string | null) {
  const drm = new DocumentError(
    'drm',
    'This EPUB is protected by DRM, so it can only be read in the app it was bought for.',
    'Books without DRM (from many publishers, Project Gutenberg, Standard Ebooks…) open fine.',
  );
  if (files['META-INF/rights.xml'] || files['sinf.xml'] || files['META-INF/sinf.xml']) throw drm;
  const enc = xml(read('META-INF/encryption.xml'));
  if (!enc) return;
  for (const data of Array.from(enc.getElementsByTagNameNS('*', 'EncryptedData'))) {
    const algorithm = data.getElementsByTagNameNS('*', 'EncryptionMethod')[0]?.getAttribute('Algorithm') ?? '';
    const uri = data.getElementsByTagNameNS('*', 'CipherReference')[0]?.getAttribute('URI') ?? '';
    if (FONT_OBFUSCATION.includes(algorithm) || FONT_EXT.test(uri)) continue;
    throw drm;
  }
}

function parseChapter(src: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(src, 'application/xhtml+xml');
  if (!doc.getElementsByTagName('parsererror').length) return doc;
  return parser.parseFromString(src, 'text/html'); // plenty of EPUBs contain sloppy XHTML
}

function serializeChildren(body: Element): string {
  // Re-serialize as HTML (not XML) so namespaces and self-closing tags don't confuse the sanitizer.
  const holder = document.createElement('div');
  for (const child of Array.from(body.childNodes)) holder.append(document.importNode(child, true));
  return holder.innerHTML;
}

function xml(src: string | null): Document | null {
  if (!src) return null;
  const doc = new DOMParser().parseFromString(src, 'application/xml');
  return doc.getElementsByTagName('parsererror').length ? null : doc;
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i + 1);
}

/** Resolve `href` (URL-encoded, maybe with ../) against a directory inside the archive. */
export function join(dir: string, href: string): string {
  const parts = (dir + decodeURIComponentSafe(href.split('#')[0] ?? '')).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

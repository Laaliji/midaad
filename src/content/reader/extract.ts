import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { containsArabic, countWords, detectDirection, guessLang, readingMinutes } from '../../shared/text';

export interface Article {
  url: string;
  title: string;
  byline: string | null;
  siteName: string;
  publishedTime: string | null;
  lang: string | undefined;
  dir: 'ltr' | 'rtl';
  /** Sanitized article body, ready to be cloned into the reader. */
  content: DocumentFragment;
  textContent: string;
  words: number;
  minutes: number;
  hasArabic: boolean;
}

const MIN_TEXT_LENGTH = 250;
const RTL_LANGS = /^(ar|fa|ur|he|ps|sd|ug|yi|ckb)\b/i;

let hooksInstalled = false;
function installSanitizerHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof HTMLAnchorElement) {
      const href = node.getAttribute('href') ?? '';
      if (href && !href.startsWith('#')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    } else if (node instanceof HTMLImageElement) {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
    }
  });
}

/**
 * Extract the main article from the page with Mozilla Readability.
 * Readability runs on a clone, so the live page is never modified. The result is sanitized
 * with DOMPurify, because Readability keeps attributes such as `onerror`, which would otherwise
 * run in the page.
 */
export function extractArticle(doc: Document = document): Article | null {
  const clone = doc.cloneNode(true) as Document;
  // Never let our own UI end up in the article.
  clone.querySelectorAll('[data-midaad-host]').forEach((el) => el.remove());

  let parsed: ReturnType<Readability<string>['parse']>;
  try {
    parsed = new Readability(clone, { charThreshold: 400, keepClasses: false }).parse();
  } catch (err) {
    console.warn('[Midaad] Readability failed', err);
    return null;
  }
  if (!parsed?.content || (parsed.textContent ?? '').trim().length < MIN_TEXT_LENGTH) return null;

  installSanitizerHooks();
  const content = DOMPurify.sanitize(parsed.content, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'object', 'embed', 'link', 'meta'],
    FORBID_ATTR: ['style', 'class', 'tabindex', 'contenteditable'],
    ADD_ATTR: ['target'],
  }) as DocumentFragment;

  const textContent = (parsed.textContent ?? '').replace(/\s+/g, ' ').trim();
  const title = (parsed.title || doc.title || '').trim();
  const byline = cleanByline(parsed.byline);
  tidy(content, title, byline);

  // Language and direction: trust the page unless its script obviously disagrees.
  const scriptDir = detectDirection(textContent);
  let lang = (parsed.lang || doc.documentElement.lang || '').trim() || undefined;
  if (scriptDir === 'rtl' && !RTL_LANGS.test(lang ?? '')) lang = guessLang(textContent) ?? lang;
  if (scriptDir === 'ltr' && RTL_LANGS.test(lang ?? '')) lang = guessLang(textContent) ?? lang;
  const declaredDir = parsed.dir?.toLowerCase();
  const dir: 'ltr' | 'rtl' = declaredDir === 'rtl' || declaredDir === 'ltr' ? (declaredDir === scriptDir ? declaredDir : scriptDir) : scriptDir;

  const words = countWords(textContent, lang);
  return {
    url: location.href,
    title,
    byline,
    siteName: (parsed.siteName || location.hostname.replace(/^www\./, '')).trim(),
    publishedTime: parsed.publishedTime ?? null,
    lang,
    dir,
    content,
    textContent,
    words,
    minutes: readingMinutes(words, lang),
    hasArabic: containsArabic(textContent) || containsArabic(title),
  };
}

/** Small cleanups Readability leaves behind. */
function tidy(fragment: DocumentFragment, title: string, byline: string | null) {
  // Drop a leading heading that just repeats the title.
  const firstHeading = fragment.querySelector('h1, h2');
  if (firstHeading && normalize(firstHeading.textContent) === normalize(title)) firstHeading.remove();

  // Drop an early paragraph that just repeats the byline (we show it in the header).
  if (byline) {
    const b = stripByPrefix(normalize(byline));
    for (const el of Array.from(fragment.querySelectorAll('p, span, address')).slice(0, 6)) {
      const t = stripByPrefix(normalize(el.textContent));
      if (t && t === b) {
        el.remove();
        break;
      }
    }
  }

  // Make wide tables scroll inside their own box instead of breaking the layout.
  fragment.querySelectorAll('table').forEach((table) => {
    const wrap = document.createElement('div');
    wrap.className = 'mw-table';
    table.replaceWith(wrap);
    wrap.append(table);
  });

  // Remove empty paragraphs/divs that create big gaps.
  fragment.querySelectorAll('p, div').forEach((el) => {
    if (!el.textContent?.trim() && !el.querySelector('img, picture, video, svg, table, pre')) el.remove();
  });
}

function cleanByline(byline: string | null | undefined): string | null {
  const b = byline?.replace(/\s+/g, ' ').trim();
  if (!b || b.length > 120) return null;
  return b;
}

/** "By Jane Doe" / "بقلم: فلان" → "jane doe" / "فلان" */
export function stripByPrefix(s: string): string {
  return s.replace(/^(by|بقلم:?)\s+/u, '');
}

function normalize(s: string | null | undefined) {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

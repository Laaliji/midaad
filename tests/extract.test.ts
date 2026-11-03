import { describe, expect, it } from 'vitest';
import { extractArticle } from '../src/content/reader/extract';

const para = (s: string, n = 4) => Array.from({ length: n }, () => `<p>${s}</p>`).join('');

function docFrom(html: string, lang = 'en'): Document {
  return new DOMParser().parseFromString(`<!doctype html><html lang="${lang}"><head><title>T</title></head><body>${html}</body></html>`, 'text/html');
}

const EN = 'We read more words than ever, yet we remember fewer of them. Feeds reward the scroll, not the sentence, and the result is reading that never touches depth.';
const AR = 'نقرأ اليوم كلماتٍ أكثر من أي وقتٍ مضى، لكننا نتذكر منها أقل. فالمنصات تكافئ التمرير السريع لا الجملة المتأملة، والنتيجة قراءةٌ تمرّ على سطح الأفكار.';

describe('extractArticle', () => {
  it('returns null when there is no real article', () => {
    expect(extractArticle(docFrom('<p>Hi there.</p>'))).toBeNull();
  });

  it('extracts title, removes the duplicated byline and keeps the body', () => {
    const doc = docFrom(
      `<article><h1>Why Slow Reading Matters</h1><p class="byline">By Lina Haddad</p>${para(EN, 5)}</article>`,
    );
    const meta = doc.createElement('meta');
    meta.name = 'author';
    meta.content = 'Lina Haddad';
    doc.head.append(meta);

    const a = extractArticle(doc)!;
    expect(a).not.toBeNull();
    expect(a.byline).toBe('Lina Haddad');
    expect(a.dir).toBe('ltr');
    expect(a.content.textContent).not.toContain('By Lina Haddad');
    expect(a.words).toBeGreaterThan(100);
  });

  it('strips event handlers and scripts (Readability keeps them)', () => {
    const doc = docFrom(
      `<article><h1>Title</h1>${para(EN, 4)}<p>Image: <img src="x.png" onerror="alert(1)"><script>alert(2)</script></p>${para(EN, 2)}</article>`,
    );
    const a = extractArticle(doc)!;
    const holder = document.createElement('div');
    holder.append(a.content.cloneNode(true));
    expect(holder.innerHTML).not.toContain('onerror');
    expect(holder.innerHTML).not.toContain('<script');
  });

  it('detects Arabic articles as RTL even when the page claims English', () => {
    const a = extractArticle(docFrom(`<article><h1>عنوان المقال</h1>${para(AR, 6)}</article>`, 'en'))!;
    expect(a.dir).toBe('rtl');
    expect(a.lang).toBe('ar');
    expect(a.hasArabic).toBe(true);
  });

  it('makes external links open in a new tab but leaves in-page anchors alone', () => {
    const a = extractArticle(
      docFrom(`<article><h1>T</h1>${para(EN, 4)}<p><a href="https://example.com/x">ext</a> <a href="#fn1">1</a></p>${para(EN, 2)}</article>`),
    )!;
    const links = Array.from(a.content.querySelectorAll('a'));
    const ext = links.find((l) => l.textContent === 'ext')!;
    const fn = links.find((l) => l.textContent === '1')!;
    expect(ext.getAttribute('target')).toBe('_blank');
    expect(ext.getAttribute('rel')).toContain('noopener');
    expect(fn.hasAttribute('target')).toBe(false);
  });
});

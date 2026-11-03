import { describe, expect, it } from 'vitest';
import {
  anchorQuote,
  buildIndex,
  collapseWhitespace,
  describeRange,
  stripWhitespace,
} from '../src/content/highlights/anchor';

function el(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.replaceChildren(div);
  return div;
}

/** Select the n-th occurrence (0-based) of `text` inside `root`, within a single text node. */
function select(root: Node, text: string, nth = 0): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    let from = 0;
    for (let i = n.data.indexOf(text, from); i !== -1; i = n.data.indexOf(text, from)) {
      if (seen++ === nth) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + text.length);
        return r;
      }
      from = i + 1;
    }
  }
  throw new Error(`"${text}" #${nth} not found`);
}

describe('whitespace helpers', () => {
  it('strip and collapse ignore spaces, line breaks, nbsp and zero-width characters', () => {
    const nbsp = String.fromCharCode(0xa0);
    const zwsp = String.fromCharCode(0x200b);
    const s = ` a${nbsp} b${String.fromCharCode(10)}${String.fromCharCode(9)}c${zwsp}d `;
    expect(stripWhitespace(s)).toBe('abcd');
    expect(collapseWhitespace(s)).toBe('a b cd');
  });
});

describe('describe + anchor', () => {
  it('round-trips a selection in the same document', () => {
    const root = el('<p>The quick brown fox jumps over the lazy dog.</p>');
    const d = describeRange(select(root, 'brown fox'), buildIndex(root))!;
    expect(d.quote.exact).toBe('brownfox');
    expect(d.quote.prefix).toBe('Thequick');
    const r = anchorQuote(buildIndex(root), d.quote, d.position)!;
    expect(r.toString()).toBe('brown fox');
  });

  it('finds a quote made in reader view on a page with different markup and whitespace', () => {
    const reader = el('<p>Reading slowly is a <em>kind of</em> listening.</p><p>It takes time.</p>');
    const d = describeRange(select(reader, 'kind of'), buildIndex(reader))!;

    const page = el(`
      <nav>Home · About</nav>
      <article>
        <p>Reading   slowly is a
           <span>kind</span>   <b>of</b> listening.</p>
        <script>var kindof = 1;</script>
      </article>`);
    const r = anchorQuote(buildIndex(page), d.quote, d.position)!;
    expect(collapseWhitespace(r.toString())).toBe('kind of');
  });

  it('uses context to pick the right one of several identical quotes', () => {
    const html = '<p>First, the river. Then the river again.</p><p>Finally the river ends.</p>';
    const root = el(html);
    const d = describeRange(select(root, 'the river', 1), buildIndex(root))!;
    const page = el(`<div><h1>Rivers</h1>${html}</div>`);
    const r = anchorQuote(buildIndex(page), d.quote, d.position)!;
    const p = r.startContainer.parentElement!;
    expect(p.textContent).toContain('Then the river again');
    expect(r.startOffset).toBe(p.textContent!.indexOf('the river again'));
  });

  it('anchors Arabic text across nodes', () => {
    const root = el('<p dir="rtl">المداد أبقى من <strong>الذاكرة</strong>، والقراءة على مهل.</p>');
    const range = document.createRange();
    const strong = root.querySelector('strong')!;
    range.setStart(root.querySelector('p')!.firstChild!, 'المداد '.length);
    range.setEnd(strong.firstChild!, strong.textContent!.length);
    const d = describeRange(range, buildIndex(root))!;
    expect(d.quote.exact).toBe('أبقىمنالذاكرة');

    const page = el('<div><span>المداد</span> <span>أبقى من الذاكرة</span>، والقراءة على مهل.</div>');
    expect(anchorQuote(buildIndex(page), d.quote, d.position)!.toString()).toBe('أبقى من الذاكرة');
  });

  it('returns null when the text is gone, and for selections with no text', () => {
    const root = el('<p>Alpha beta gamma.</p>');
    const d = describeRange(select(root, 'beta'), buildIndex(root))!;
    const other = el('<p>Completely different words.</p>');
    expect(anchorQuote(buildIndex(other), d.quote, d.position)).toBeNull();

    const blank = el('<p>   </p><p>x</p>');
    const r = document.createRange();
    r.selectNodeContents(blank.firstChild!);
    expect(describeRange(r, buildIndex(blank))).toBeNull();
  });
});

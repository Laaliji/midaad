/**
 * Text anchoring: turn a DOM Range into a durable text quote, and find that quote again later,
 * in reader view or on the original page.
 *
 * Matching ignores all whitespace. Reader view and the original page split text into different
 * nodes and lay out spaces and line breaks differently, but the sequence of visible characters is
 * the same. When a quote appears several times, the stored prefix/suffix and approximate position
 * pick the right one.
 */
import { LIMITS, type TextQuote } from '../../shared/highlights';

/** Elements whose text is never part of the readable page. */
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'textarea', 'input', 'select', 'option', 'button', 'svg', 'math', 'iframe',
  'canvas', 'video', 'audio', 'object', 'head', 'title',
]);

/** Whitespace, zero-width characters and soft hyphens: ignored when matching. */
export function isIgnorable(code: number): boolean {
  return (
    code <= 0x20 ||
    code === 0x7f ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0xad ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200b) ||
    code === 0x200d ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x2060 ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

export function stripWhitespace(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) if (!isIgnorable(s.charCodeAt(i))) out += s[i];
  return out;
}

/** Collapse runs of whitespace into single spaces and trim, for display. */
export function collapseWhitespace(s: string): string {
  let out = '';
  let pendingSpace = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isIgnorable(c)) {
      // Zero-width characters and soft hyphens vanish; real whitespace becomes one space.
      if (c !== 0xad && c !== 0x200b && c !== 0x200d && c !== 0x2060 && c !== 0xfeff) pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) out += ' ';
    pendingSpace = false;
    out += s[i];
  }
  return out;
}

/**
 * Every visible character under `root`, with whitespace removed, plus a map from each character
 * back to its text node and offset.
 */
export interface TextIndex {
  text: string;
  nodeOf: Text[];
  offsetOf: Int32Array;
}

export function buildIndex(root: Node): TextIndex {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (SKIP_TAGS.has(el.localName) || el.hasAttribute('data-midaad-host') || el.hasAttribute('data-midaad-ui')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const chars: string[] = [];
  const nodes: Text[] = [];
  const offsets: number[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const data = t.data;
    for (let i = 0; i < data.length; i++) {
      if (isIgnorable(data.charCodeAt(i))) continue;
      chars.push(data[i]!);
      nodes.push(t);
      offsets.push(i);
    }
  }
  return { text: chars.join(''), nodeOf: nodes, offsetOf: Int32Array.from(offsets) };
}

/** Index range [start, end] (inclusive) of the characters a DOM range covers, or null if none. */
function charSpan(index: TextIndex, range: Range): [number, number] | null {
  const n = index.text.length;
  if (!n) return null;
  const cmp = (k: number, after: 0 | 1) => {
    try {
      return range.comparePoint(index.nodeOf[k]!, index.offsetOf[k]! + after);
    } catch {
      return -2; // node in a different tree
    }
  };
  // First character whose start lies at or after the range start.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cmp(mid, 0) < 0) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  // Last character whose end lies at or before the range end.
  lo = -1;
  hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cmp(mid, 1) <= 0 && cmp(mid, 1) !== -2) lo = mid;
    else hi = mid - 1;
  }
  const end = lo;
  if (start > end || start >= n) return null;
  return [start, end];
}

export interface Described {
  quote: TextQuote;
  position: number;
  /** Characters matched (whitespace excluded). */
  length: number;
  /** Character span in the index, inclusive. */
  span: [number, number];
}

/** Describe a selection as a text quote. Returns null if it contains no readable text. */
export function describeRange(range: Range, index: TextIndex): Described | null {
  const span = charSpan(index, range);
  if (!span) return null;
  const [start, end] = span;
  const { text } = index;
  return {
    quote: {
      exact: text.slice(start, end + 1),
      prefix: text.slice(Math.max(0, start - LIMITS.context), start),
      suffix: text.slice(end + 1, end + 1 + LIMITS.context),
    },
    position: text.length ? start / text.length : 0,
    length: end - start + 1,
    span,
  };
}

/** Number of matching characters at the end of `a` and `b`. */
function commonSuffix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

const MAX_CANDIDATES = 2000;

/** Find the best match for a quote; returns its character span in the index. */
export function findQuote(index: TextIndex, quote: TextQuote, position: number): [number, number] | null {
  const { text } = index;
  const { exact, prefix, suffix } = quote;
  if (!exact || exact.length > text.length) return null;

  let best = -1;
  let bestScore = -Infinity;
  let found = 0;
  for (let i = text.indexOf(exact); i !== -1 && found < MAX_CANDIDATES; i = text.indexOf(exact, i + 1)) {
    found++;
    const end = i + exact.length;
    const pre = commonSuffix(text.slice(Math.max(0, i - prefix.length), i), prefix);
    const suf = commonPrefix(text.slice(end, end + suffix.length), suffix);
    // Context dominates; position (0..8 points) breaks ties between identical contexts.
    const score = pre + suf + 8 * (1 - Math.min(1, Math.abs(i / text.length - position)));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best === -1 ? null : [best, best + exact.length - 1];
}

/** Find the quote and return a live DOM Range over it, or null if the text isn't on the page. */
export function anchorQuote(index: TextIndex, quote: TextQuote, position: number): Range | null {
  const span = findQuote(index, quote, position);
  return span ? rangeFromSpan(index, span) : null;
}

/** A DOM Range over an inclusive character span of the index. */
export function rangeFromSpan(index: TextIndex, [start, end]: [number, number]): Range {
  const startNode = index.nodeOf[start]!;
  const range = (startNode.ownerDocument ?? document).createRange();
  range.setStart(startNode, index.offsetOf[start]!);
  range.setEnd(index.nodeOf[end]!, index.offsetOf[end]! + 1);
  return range;
}

/**
 * Paints highlights with the CSS Custom Highlight API: no <mark> elements, no changes to the
 * page's DOM, so sites built with React and similar frameworks can't break or be broken by us.
 *
 * The highlight registry belongs to the document and is shared by every tree in it, so ranges in
 * reader view (inside our shadow root) and on the page live in the same registry. Each tree
 * supplies its own `::highlight()` styles.
 */
import { HIGHLIGHT_COLORS, type HighlightColor } from '../../shared/highlights';

export interface Painted {
  range: Range;
  color: HighlightColor;
  hasNote: boolean;
}

const PREFIX = 'midaad-';
const NOTE = `${PREFIX}note`;
const ACTIVE = `${PREFIX}active`;

const layers = new Map<string, Map<string, Painted>>();
let activeId: string | null = null;
let frame = 0;

export function supported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

/** Replace everything a surface (page or reader) has painted. */
export function paintLayer(layer: string, items: Map<string, Painted>) {
  layers.set(layer, items);
  schedule();
}

export function clearLayer(layer: string) {
  layers.delete(layer);
  schedule();
}

/** Emphasize one highlight (while its popover is open). */
export function setActive(id: string | null) {
  activeId = id;
  schedule();
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(repaint);
}

function repaint() {
  frame = 0;
  if (!supported()) return;
  const byColor = new Map<HighlightColor, Range[]>(HIGHLIGHT_COLORS.map((c) => [c.id, []]));
  const notes: Range[] = [];
  const active: Range[] = [];
  for (const items of layers.values()) {
    for (const [id, p] of items) {
      byColor.get(p.color)?.push(p.range);
      if (p.hasNote) notes.push(p.range);
      if (id === activeId) active.push(p.range);
    }
  }
  for (const [color, ranges] of byColor) setRegistry(`${PREFIX}${color}`, ranges, 1);
  setRegistry(NOTE, notes, 2);
  setRegistry(ACTIVE, active, 3);
}

function setRegistry(name: string, ranges: Range[], priority: number) {
  if (!ranges.length) {
    CSS.highlights.delete(name);
    return;
  }
  const h = new Highlight(...ranges);
  h.priority = priority;
  CSS.highlights.set(name, h);
}

/** Remove every Midaad entry, including any left by an older copy of the content script. */
export function clearAll() {
  layers.clear();
  activeId = null;
  if (!supported()) return;
  for (const name of [...CSS.highlights.keys()]) if (name.startsWith(PREFIX)) CSS.highlights.delete(name);
}

/**
 * `::highlight()` rules for one tree. `scope` prefixes each rule (for example a theme selector
 * inside reader view); pass '' for the page.
 */
export function paintCss(theme: 'light' | 'dark', scope = ''): string {
  const sel = (name: string) => `${scope ? `${scope} ` : ''}::highlight(${name})`;
  const colors = HIGHLIGHT_COLORS.map(
    (c) => `${sel(PREFIX + c.id)} { background-color: ${theme === 'dark' ? c.dark : c.light}; }`,
  ).join('\n');
  const line = theme === 'dark' ? 'rgb(236 233 214 / 0.75)' : 'rgb(51 61 41 / 0.7)';
  const active = theme === 'dark' ? 'rgb(236 233 214 / 0.12)' : 'rgb(51 61 41 / 0.1)';
  return `${colors}
${sel(NOTE)} { text-decoration: underline dotted ${line}; text-decoration-thickness: 2px; }
${sel(ACTIVE)} { background-color: ${active}; text-decoration: underline solid ${line}; text-decoration-thickness: 2px; }`;
}

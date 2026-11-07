/**
 * Highlights on pictures: scanned pages and other figures drawn from a PDF, where there is no
 * text to select. You drag a box over part of the picture; it's stored as fractions of the
 * figure, so it lands in the same place at any column width or zoom.
 *
 * Figures are `<figure data-pdf-page data-pdf-box>` with a `[data-pdf-figure]` slot (see
 * documents/pdfLayout.ts). Boxes are painted as elements inside the slot, over the canvas.
 */
import { colorInfo, type Highlight, type HighlightArea } from '../../shared/highlights';

const SLOT = '[data-pdf-figure]';
/** Smallest box kept, in CSS pixels (smaller drags are clicks). */
export const MIN_AREA_PX = 8;

/** The picture under an event target, if it can carry area highlights. */
export function slotAt(target: EventTarget | null, root: Element): HTMLElement | null {
  const el = (target as Element | null)?.closest?.(SLOT) as HTMLElement | null;
  if (!el || !root.contains(el) || !el.closest('figure[data-pdf-page][data-pdf-box]')) return null;
  return el;
}

function figureOf(slot: HTMLElement): HTMLElement {
  return slot.closest('figure') as HTMLElement;
}

/** Which figure an area belongs to: its page and box, as written in the HTML. */
export function figureKey(slot: HTMLElement): { page: number; figure: string } {
  const fig = figureOf(slot);
  return { page: Number(fig.dataset.pdfPage) || 1, figure: fig.dataset.pdfBox ?? '' };
}

function findSlot(root: Element, area: HighlightArea): HTMLElement | null {
  for (const fig of root.querySelectorAll<HTMLElement>('figure[data-pdf-page][data-pdf-box]')) {
    if (Number(fig.dataset.pdfPage) === area.page && fig.dataset.pdfBox === area.figure) {
      return fig.querySelector<HTMLElement>(SLOT);
    }
  }
  return null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The box between two points, as fractions of the slot. Null when it's too small. */
export function areaBetween(slot: HTMLElement, a: { x: number; y: number }, b: { x: number; y: number }): HighlightArea | null {
  const r = slot.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const x0 = clamp01((Math.min(a.x, b.x) - r.left) / r.width);
  const x1 = clamp01((Math.max(a.x, b.x) - r.left) / r.width);
  const y0 = clamp01((Math.min(a.y, b.y) - r.top) / r.height);
  const y1 = clamp01((Math.max(a.y, b.y) - r.top) / r.height);
  if ((x1 - x0) * r.width < MIN_AREA_PX || (y1 - y0) * r.height < MIN_AREA_PX) return null;
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return { ...figureKey(slot), x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) };
}

/** Where the area starts, as a fraction of the article's height (orders highlights in lists). */
export function areaPosition(root: Element, slot: HTMLElement, area: HighlightArea): number {
  const body = root.getBoundingClientRect();
  const r = slot.getBoundingClientRect();
  if (body.height < 1) return 0;
  return clamp01((r.top - body.top + area.y * r.height) / body.height);
}

function place(el: HTMLElement, area: Pick<HighlightArea, 'x' | 'y' | 'w' | 'h'>) {
  el.style.left = `${area.x * 100}%`;
  el.style.top = `${area.y * 100}%`;
  el.style.width = `${area.w * 100}%`;
  el.style.height = `${area.h * 100}%`;
}

/** The dashed box shown while dragging, and until a colour is picked. */
export function createBand(slot: HTMLElement): HTMLElement {
  const band = document.createElement('div');
  band.className = 'mh-band';
  band.setAttribute('aria-hidden', 'true');
  slot.append(band);
  return band;
}

export function moveBand(band: HTMLElement, slot: HTMLElement, a: { x: number; y: number }, b: { x: number; y: number }) {
  const r = slot.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return;
  const x0 = clamp01((Math.min(a.x, b.x) - r.left) / r.width);
  const x1 = clamp01((Math.max(a.x, b.x) - r.left) / r.width);
  const y0 = clamp01((Math.min(a.y, b.y) - r.top) / r.height);
  const y1 = clamp01((Math.max(a.y, b.y) - r.top) / r.height);
  place(band, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

export function areaLabel(area: HighlightArea): string {
  return `Highlighted area, page ${area.page}`;
}

/**
 * Show the area highlights in `items` inside their figures, and remove any others.
 * Returns the elements by highlight id (for hit testing and positioning popovers).
 */
export function paintAreas(root: Element, items: readonly Highlight[], activeId: string | null): Map<string, HTMLElement> {
  const painted = new Map<string, HTMLElement>();
  const existing = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>('.mh-area')) existing.set(el.dataset.mhArea ?? '', el);

  for (const hl of items) {
    if (!hl.area) continue;
    const slot = findSlot(root, hl.area);
    if (!slot) continue;
    let el = existing.get(hl.id);
    existing.delete(hl.id);
    if (!el || el.parentElement !== slot) {
      el?.remove();
      el = document.createElement('div');
      el.className = 'mh-area';
      el.dataset.mhArea = hl.id;
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      slot.append(el);
    }
    const hasNote = !!hl.note.trim();
    place(el, hl.area);
    el.style.setProperty('--mh-area-paint', colorInfo(hl.color).light);
    el.style.setProperty('--mh-area-swatch', colorInfo(hl.color).swatch);
    el.classList.toggle('has-note', hasNote);
    el.classList.toggle('is-active', hl.id === activeId);
    el.setAttribute('aria-label', `${areaLabel(hl.area)}${hasNote ? ', with a note' : ''}`);
    painted.set(hl.id, el);
  }
  for (const el of existing.values()) el.remove();
  return painted;
}

export function clearAreas(root: Element) {
  for (const el of root.querySelectorAll('.mh-area, .mh-band')) el.remove();
}

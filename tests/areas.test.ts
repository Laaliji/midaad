import { describe, expect, it } from 'vitest';
import { areaBetween, paintAreas } from '../src/content/highlights/areas';
import type { Highlight } from '../src/shared/highlights';

function setup() {
  const root = document.createElement('div');
  root.innerHTML = '<figure data-pdf-page="2" data-pdf-box="0 0 612 792"><div data-pdf-figure data-pdf-drawn></div></figure>';
  document.body.append(root);
  const slot = root.querySelector<HTMLElement>('[data-pdf-figure]')!;
  slot.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 800, right: 500, bottom: 850, x: 100, y: 50, toJSON() {} }) as DOMRect;
  return { root, slot };
}

describe('area highlights', () => {
  it('stores a drag as fractions of the figure, whichever way it was drawn', () => {
    const { slot } = setup();
    const a = areaBetween(slot, { x: 500, y: 450 }, { x: 140, y: 250 })!;
    expect(a).toEqual({ page: 2, figure: '0 0 612 792', x: 0.1, y: 0.25, w: 0.9, h: 0.25 });
  });

  it('clamps to the figure and ignores tiny drags', () => {
    const { slot } = setup();
    expect(areaBetween(slot, { x: 0, y: 0 }, { x: 300, y: 100 })).toMatchObject({ x: 0, y: 0, w: 0.5 });
    expect(areaBetween(slot, { x: 200, y: 200 }, { x: 204, y: 260 })).toBeNull();
  });

  it('paints boxes in their figure and removes deleted ones', () => {
    const { root } = setup();
    const hl = { id: 'a'.repeat(32), color: 'sage', note: 'n', area: { page: 2, figure: '0 0 612 792', x: 0.1, y: 0.2, w: 0.3, h: 0.1 } } as Highlight;
    const els = paintAreas(root, [hl], null);
    const el = els.get(hl.id)!;
    expect(el.style.left).toBe('10%');
    expect(el.classList.contains('has-note')).toBe(true);
    expect(el.getAttribute('aria-label')).toBe('Highlighted area, page 2, with a note');
    paintAreas(root, [], null);
    expect(root.querySelector('.mh-area')).toBeNull();
  });
});

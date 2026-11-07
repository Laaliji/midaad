/**
 * Draws the figures of a converted PDF (diagrams, photos, slides, scanned pages) from the
 * original file, in the reader. pdfLayout writes each one as
 * `<figure data-pdf-page="3" data-pdf-box="x0 y0 x1 y1">` (PDF units) with an empty
 * `[data-pdf-figure]` slot; here the slot gets a canvas, drawn when it comes near the screen,
 * sharp at the screen's resolution. Space is reserved up front, so the reading position restores
 * to the right place before anything is drawn.
 */
import { AnnotationMode, type PDFDocumentLoadingTask, type PDFPageProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { openPdf } from './pdf';

/** Largest canvas drawn, in device pixels (a full scanned page on a 2x screen fits). */
const MAX_PIXELS = 12_000_000;
/** How far below and above the screen figures are drawn ahead of time. */
const AHEAD = '1500px 0px';

type Rect = [number, number, number, number];

function parseBox(value: string | undefined): Rect | null {
  const parts = (value ?? '').split(' ').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x0, y0, x1, y1] = parts as Rect;
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}

/** Start drawing the figures inside `body`. Returns a function that stops and frees everything. */
export function mountPdfFigures(body: HTMLElement, file: Uint8Array): () => void {
  const figures = [...body.querySelectorAll<HTMLElement>('figure[data-pdf-page][data-pdf-box]')];
  if (!figures.length) return () => {};

  for (const fig of figures) {
    const box = parseBox(fig.dataset.pdfBox);
    const slot = fig.querySelector<HTMLElement>('[data-pdf-figure]');
    if (!box || !slot) continue;
    sizeSlot(slot, box[2] - box[0], box[3] - box[1]);
  }

  let stopped = false;
  let task: PDFDocumentLoadingTask | null = null;
  let current: RenderTask | null = null;
  let open: PDFPageProxy | null = null;
  const queue: HTMLElement[] = [];
  let busy = false;

  const pump = async () => {
    if (busy) return;
    busy = true;
    while (queue.length && !stopped) {
      const fig = queue.shift()!;
      try {
        await draw(fig);
      } catch (err) {
        if (stopped) break;
        console.warn('[Midaad] could not draw a figure', err);
        fig.querySelector('[data-pdf-figure]')?.setAttribute('data-pdf-failed', '');
      }
    }
    busy = false;
  };

  const draw = async (fig: HTMLElement) => {
    const slot = fig.querySelector<HTMLElement>('[data-pdf-figure]');
    const box = parseBox(fig.dataset.pdfBox);
    const pageNo = Number(fig.dataset.pdfPage);
    if (!slot) return;
    if (!box || !(pageNo >= 1)) throw new Error('bad figure reference');

    const doc = await (task ??= openPdf(file, { forDrawing: true })).promise;
    if (stopped) return;
    if (pageNo > doc.numPages) throw new Error(`no page ${pageNo}`);
    // Figures on the same page follow each other in the queue: keep the page (and its decoded
    // pictures) until the next figure is on another page.
    if (open?.pageNumber !== pageNo) {
      open?.cleanup();
      open = await doc.getPage(pageNo);
    }
    const page = open;
    // The box is in the page's own coordinates; the viewport applies the page's rotation.
    const base = page.getViewport({ scale: 1 });
    const [ax, ay] = base.convertToViewportPoint(box[0], box[1]) as [number, number];
    const [bx, by] = base.convertToViewportPoint(box[2], box[3]) as [number, number];
    const left = Math.min(ax, bx);
    const top = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);
    if (w < 1 || h < 1) throw new Error('empty figure');
    sizeSlot(slot, w, h); // rotated pages swap width and height

    const cssWidth = slot.clientWidth || w;
    const scale = Math.min(4, (cssWidth * devicePixelRatio) / w, Math.sqrt(MAX_PIXELS / (w * h)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    current = page.render({
      canvas,
      viewport: page.getViewport({ scale }),
      transform: [1, 0, 0, 1, -left * scale, -top * scale],
      annotationMode: AnnotationMode.DISABLE,
    });
    await current.promise;
    current = null;
    if (stopped) return;
    if (!queue.length) open?.cleanup();
    canvas.setAttribute('aria-hidden', 'true'); // the slot carries the description
    slot.querySelector('canvas')?.remove();
    slot.prepend(canvas); // keep highlight boxes already placed on top
    slot.setAttribute('data-pdf-drawn', '');
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        queue.push(e.target as HTMLElement);
      }
      // Draw from the top of the screen down.
      queue.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      void pump();
    },
    { root: body.closest('.mr-scroller'), rootMargin: AHEAD },
  );
  figures.forEach((f) => io.observe(f));

  return () => {
    stopped = true;
    io.disconnect();
    queue.length = 0;
    current?.cancel();
    open?.cleanup();
    void task?.destroy().catch(() => {});
  };
}

/**
 * Reserve the figure's space: its shape, and a width no larger than about its printed size, so
 * a small logo isn't blown up to the full column.
 */
function sizeSlot(slot: HTMLElement, w: number, h: number) {
  slot.style.aspectRatio = `${Math.round(w * 10) / 10} / ${Math.round(h * 10) / 10}`;
  slot.style.maxWidth = `${Math.round(w * 1.6)}px`;
}

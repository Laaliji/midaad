/**
 * One highlighting surface: the original page, or the article inside reader view.
 * It watches selections, shows the toolbar, anchors stored highlights to the text, paints them,
 * and opens a popover when you click one.
 */
import { h, render } from 'preact';
import { LIMITS, type HighlightColor, type PageMeta } from '../../shared/highlights';
import type { HighlightSettings } from '../../shared/settings';
import { showToast } from '../ui/toast';
import { anchorQuote, buildIndex, collapseWhitespace, describeRange, rangeFromSpan } from './anchor';
import { copyText, selectionActions } from './actions';
import { HighlightLayer, type LayerState } from './HighlightLayer';
import { clearLayer, paintLayer, setActive, type Painted } from './painter';
import type { HighlightStore } from './store';
import { newId } from '../../shared/highlights';

export interface HighlighterConfig {
  /** Painter layer name; also used in logs. */
  layer: 'page' | 'reader';
  /** The text that can be highlighted. */
  root: Element;
  /** Where selection and pointer events happen (the document, or reader view's shadow root). */
  events: Document | ShadowRoot;
  /** Container for the toolbar and popover. */
  ui: HTMLElement;
  /**
   * The outermost element of our UI as seen from `events`. Listeners on the document can't see
   * inside a closed shadow root, so on the page this is the shadow host. Defaults to `ui`.
   */
  uiBoundary?: Element;
  getSelection: () => Selection | null;
  pageMeta: () => Omit<PageMeta, 'url'>;
  theme: () => 'light' | 'dark';
  settings: () => HighlightSettings;
  store: HighlightStore;
  /** Re-anchor when the page changes underneath us (single-page apps, lazy content). */
  watchMutations?: boolean;
}

const INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, video, audio, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"]';
const MIN_CHARS = 2;
const RETRY_LIMIT = 40;

export class Highlighter {
  private ranges = new Map<string, Range>();
  private missing = new Set<string>();
  private state: LayerState = { kind: 'none' };
  private selectionRange: Range | null = null;
  private cleanups: (() => void)[] = [];
  private down: { x: number; y: number } | null = null;
  private mutationTimer = 0;
  private retries = 0;
  private selTimer = 0;
  private destroyed = false;

  constructor(private cfg: HighlighterConfig) {}

  start() {
    const { events, store } = this.cfg;
    this.cleanups.push(store.subscribe(() => this.sync()));

    const opts = { capture: true } as const;
    const on = <K extends string>(target: EventTarget, type: K, fn: (e: Event) => void, o: AddEventListenerOptions = opts) => {
      target.addEventListener(type, fn, o);
      this.cleanups.push(() => target.removeEventListener(type, fn, o));
    };
    on(events, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    on(events, 'pointerup', (e) => this.onPointerUp(e as PointerEvent));
    on(events, 'keyup', (e) => this.onKeyUp(e as KeyboardEvent));
    on(events, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    on(document, 'selectionchange', () => this.onSelectionChange(), { passive: true });

    if (this.cfg.watchMutations) {
      const mo = new MutationObserver(() => this.onMutations());
      mo.observe(this.cfg.root, { childList: true, subtree: true, characterData: true });
      this.cleanups.push(() => mo.disconnect());
    }
    this.sync();
  }

  destroy() {
    this.destroyed = true;
    this.closeUi();
    clearTimeout(this.mutationTimer);
    clearTimeout(this.selTimer);
    for (const fn of this.cleanups.splice(0)) fn();
    render(null, this.cfg.ui);
    clearLayer(this.cfg.layer);
    this.ranges.clear();
  }

  /** Highlight whatever is selected now (keyboard shortcut / right-click). */
  highlightSelection(color = this.cfg.settings().defaultColor): boolean {
    const range = this.currentSelection();
    if (!range) return false;
    void this.create(range, color, false);
    return true;
  }

  /** Is there a usable selection on this surface? */
  hasSelection(): boolean {
    return this.currentSelection() !== null;
  }

  /* ---------------------------------------------------------------- anchoring and painting */

  private sync() {
    if (this.destroyed) return;
    const items = this.cfg.store.all;
    const ids = new Set(items.map((x) => x.id));
    for (const id of [...this.ranges.keys()]) if (!ids.has(id)) this.ranges.delete(id);
    for (const id of [...this.missing]) if (!ids.has(id)) this.missing.delete(id);

    const unanchored = items.filter((x) => !this.ranges.has(x.id));
    if (unanchored.length) {
      const index = buildIndex(this.cfg.root);
      for (const hl of unanchored) {
        const r = anchorQuote(index, hl.quote, hl.position);
        if (r) {
          this.ranges.set(hl.id, r);
          this.missing.delete(hl.id);
        } else {
          this.missing.add(hl.id);
        }
      }
    }
    this.paint();

    // The popover's highlight was deleted (here or in the other surface).
    if (this.state.kind === 'popover' && !ids.has(this.state.id)) this.closeUi();
    else this.renderUi();
  }

  private paint() {
    const painted = new Map<string, Painted>();
    for (const hl of this.cfg.store.all) {
      const range = this.ranges.get(hl.id);
      if (range) painted.set(hl.id, { range, color: hl.color, hasNote: !!hl.note.trim() });
    }
    paintLayer(this.cfg.layer, painted);
  }

  private onMutations() {
    clearTimeout(this.mutationTimer);
    this.mutationTimer = window.setTimeout(() => {
      // Ranges whose text was removed or replaced by a re-render.
      let broken = false;
      for (const [id, r] of this.ranges) {
        if (r.collapsed || !this.cfg.root.contains(r.startContainer)) {
          this.ranges.delete(id);
          broken = true;
        }
      }
      if (broken) this.retries = 0;
      if ((broken || this.missing.size) && this.retries++ < RETRY_LIMIT) this.sync();
    }, 700);
  }

  /* ---------------------------------------------------------------- creating */

  private currentSelection(): Range | null {
    const sel = this.cfg.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const common = range.commonAncestorContainer;
    if (!this.cfg.root.contains(common)) return null;
    const el = common.nodeType === Node.ELEMENT_NODE ? (common as Element) : common.parentElement;
    if (el?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return null;
    if ((el as HTMLElement | null)?.isContentEditable) return null;
    if (stripCount(range.toString()) < MIN_CHARS) return null;
    return range;
  }

  private async create(range: Range, color: HighlightColor, withNote: boolean) {
    const index = buildIndex(this.cfg.root);
    const d = describeRange(range, index);
    if (!d || d.length < MIN_CHARS) return;
    if (d.length > LIMITS.text) {
      showToast('That selection is too long to highlight. Try a shorter passage.', this.cfg.theme());
      return;
    }
    const id = newId();
    const painted = rangeFromSpan(index, d.span);
    this.ranges.set(id, painted);
    const text = collapseWhitespace(painted.toString()).slice(0, LIMITS.text);

    this.cfg.getSelection()?.removeAllRanges();
    this.selectionRange = null;
    this.closeUi();

    const hl = await this.cfg.store.create(
      { id, quote: d.quote, position: d.position, text, color },
      this.cfg.pageMeta(),
    );
    if (hl && withNote && !this.destroyed) this.openPopover(hl.id, true);
  }

  /* ---------------------------------------------------------------- events */

  private inUi(e: Event): boolean {
    return e.composedPath().includes(this.cfg.uiBoundary ?? this.cfg.ui);
  }

  private onPointerDown(e: PointerEvent) {
    if (this.inUi(e)) return;
    this.down = { x: e.clientX, y: e.clientY };
    if (this.state.kind !== 'none') this.closeUi();
  }

  private onPointerUp(e: PointerEvent) {
    if (this.inUi(e) || e.button !== 0) return;
    const down = this.down;
    this.down = null;
    // Let the browser finish updating the selection first.
    setTimeout(() => {
      if (this.destroyed) return;
      const range = this.currentSelection();
      if (range) return this.showToolbar(range);
      const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 0;
      if (moved > 4) return;
      const target = e.target as Element | null;
      if (target?.closest?.(INTERACTIVE)) return;
      const id = this.highlightAt(e.clientX, e.clientY);
      if (id) this.openPopover(id, false);
    }, 0);
  }

  private onKeyUp(e: KeyboardEvent) {
    // Keyboard selection: Shift+arrows, Shift+Home/End, Ctrl+A.
    if (e.shiftKey || e.key === 'Shift' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')) {
      const range = this.currentSelection();
      if (range) this.showToolbar(range);
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && this.state.kind !== 'none' && !this.inUi(e)) {
      e.preventDefault();
      e.stopPropagation();
      this.closeUi();
    }
  }

  private onSelectionChange() {
    if (this.state.kind !== 'toolbar') return;
    clearTimeout(this.selTimer);
    this.selTimer = window.setTimeout(() => {
      if (this.state.kind === 'toolbar' && !this.currentSelection()) this.closeUi();
    }, 120);
  }

  /** The smallest highlight under a point (overlapping highlights: the most specific wins). */
  private highlightAt(x: number, y: number): string | null {
    let best: string | null = null;
    let bestLen = Infinity;
    for (const [id, r] of this.ranges) {
      for (const rect of Array.from(r.getClientRects())) {
        if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) {
          const len = this.cfg.store.get(id)?.quote.exact.length ?? Infinity;
          if (len < bestLen) {
            best = id;
            bestLen = len;
          }
          break;
        }
      }
    }
    return best;
  }

  /* ---------------------------------------------------------------- UI */

  private showToolbar(range: Range) {
    if (!this.cfg.settings().selectionToolbar) return;
    const r = range.cloneRange();
    this.selectionRange = r;
    this.setState({ kind: 'toolbar', rects: () => r.getClientRects() });
  }

  private openPopover(id: string, focusNote: boolean) {
    const r = this.ranges.get(id);
    if (!r) return;
    setActive(id);
    this.setState({ kind: 'popover', id, focusNote, rects: () => r.getClientRects() });
  }

  private closeUi() {
    if (this.state.kind === 'popover') setActive(null);
    this.setState({ kind: 'none' });
  }

  private setState(s: LayerState) {
    this.state = s;
    this.renderUi();
  }

  private renderUi() {
    if (this.destroyed) return;
    const { store, settings, theme } = this.cfg;
    const state = this.state;
    render(
      h(HighlightLayer, {
        state,
        highlight: state.kind === 'popover' ? store.get(state.id) : undefined,
        defaultColor: settings().defaultColor,
        onHighlight: (color) => this.selectionRange && void this.create(this.selectionRange, color, false),
        onHighlightWithNote: () => this.selectionRange && void this.create(this.selectionRange, settings().defaultColor, true),
        onAction: (actionId) => {
          const r = this.selectionRange;
          const action = selectionActions.find((a) => a.id === actionId);
          if (!r || !action) return;
          this.closeUi();
          void action.run({ text: collapseWhitespace(r.toString()), range: r, theme: theme() });
        },
        onSetColor: (id, color) => void store.update(id, { color }),
        onNote: (id, note) => {
          if (store.get(id) && store.get(id)!.note !== note) void store.update(id, { note });
        },
        onCopy: async (id) => {
          const hl = store.get(id);
          if (!hl) return;
          const ok = await copyText(hl.note.trim() ? `${hl.text}\n\n${hl.note.trim()}` : hl.text);
          showToast(ok ? 'Copied' : 'Couldn’t copy on this page', theme(), 1600);
        },
        onDelete: (id) => {
          this.closeUi();
          void store.remove(id);
        },
        onClose: () => this.closeUi(),
      }),
      this.cfg.ui,
    );
  }
}

function stripCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x20) n++;
  return n;
}

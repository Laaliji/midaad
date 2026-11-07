/**
 * The current page's highlights, cached in the content script. Reader view and the page share
 * one store, so a highlight made in either appears in both. Writes are optimistic: the UI updates
 * at once and rolls back with a message if the background can't save.
 */
import { sendToBackground } from '../../shared/messages';
import { newId, type Highlight, type HighlightArea, type HighlightPatch, type PageMeta, type TextQuote, type HighlightColor } from '../../shared/highlights';
import { showToast } from '../ui/toast';

type Listener = (items: readonly Highlight[]) => void;

export interface Draft {
  id?: string;
  quote: TextQuote;
  position: number;
  text: string;
  color: HighlightColor;
  note?: string;
  area?: HighlightArea;
}

export class HighlightStore {
  url = '';
  private items: Highlight[] = [];
  private listeners = new Set<Listener>();
  private loadToken = 0;

  get all(): readonly Highlight[] {
    return this.items;
  }

  get(id: string): Highlight | undefined {
    return this.items.find((h) => h.id === id);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async load(url: string): Promise<void> {
    const token = ++this.loadToken;
    this.url = url;
    this.set([]);
    try {
      const list = await sendToBackground('highlights/forPage', { url });
      if (token === this.loadToken) this.set(list);
    } catch (err) {
      console.warn('[Midaad] could not load highlights', err);
    }
  }

  async create(draft: Draft, page: Omit<PageMeta, 'url'>): Promise<Highlight | null> {
    const now = Date.now();
    const h: Highlight = {
      id: draft.id ?? newId(),
      url: this.url,
      quote: draft.quote,
      position: draft.position,
      text: draft.text,
      color: draft.color,
      note: draft.note ?? '',
      ...(draft.area && { area: draft.area }),
      createdAt: now,
      updatedAt: now,
    };
    this.set([...this.items, h]);
    try {
      await sendToBackground('highlights/create', { highlight: h, page: { ...page, url: this.url } });
      return h;
    } catch (err) {
      this.set(this.items.filter((x) => x.id !== h.id));
      failed('save this highlight', err);
      return null;
    }
  }

  async update(id: string, patch: HighlightPatch): Promise<void> {
    const before = this.get(id);
    if (!before) return;
    this.set(this.items.map((h) => (h.id === id ? { ...h, ...patch, updatedAt: Date.now() } : h)));
    try {
      await sendToBackground('highlights/update', { id, patch });
    } catch (err) {
      this.set(this.items.map((h) => (h.id === id ? before : h)));
      failed('save your change', err);
    }
  }

  async remove(id: string): Promise<void> {
    const before = this.items;
    this.set(this.items.filter((h) => h.id !== id));
    try {
      await sendToBackground('highlights/delete', { id });
    } catch (err) {
      this.set(before);
      failed('remove this highlight', err);
    }
  }

  private set(items: Highlight[]) {
    this.items = items;
    for (const fn of this.listeners) fn(items);
  }
}

function failed(what: string, err: unknown) {
  console.warn('[Midaad]', err);
  const msg = String(err instanceof Error ? err.message : err);
  // After the extension is reloaded or updated, old content scripts lose their connection.
  const stale = /context invalidated|Receiving end does not exist|Extension context/i.test(msg);
  showToast(stale ? 'Midaad was updated. Refresh the page to keep highlighting.' : `Midaad couldn’t ${what}.`);
}

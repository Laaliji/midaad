/**
 * Highlighting on the original page: an isolated UI host, `::highlight()` styles adopted by the
 * document, and re-loading when a single-page app navigates to another article.
 */
import tokensCss from '../../shared/ui/tokens.css?inline';
import controlsCss from '../../shared/ui/controls.css?inline';
import highlightsCss from './highlights.css?inline';
import { normalizeUrl } from '../../shared/url';
import type { HighlightSettings } from '../../shared/settings';
import { detectDirection } from '../../shared/text';
import { createShadowHost, type ShadowHost } from '../ui/shadowHost';
import { Highlighter } from './Highlighter';
import { paintCss, supported } from './painter';
import type { HighlightStore } from './store';

export class PageHighlights {
  private ui: ShadowHost | null = null;
  private highlighter: Highlighter | null = null;
  private sheet: CSSStyleSheet | null = null;
  private stopNav: (() => void) | null = null;
  private theme: 'light' | 'dark' = 'light';

  constructor(
    private store: HighlightStore,
    private settings: () => HighlightSettings,
  ) {}

  async start() {
    if (!supported() || !document.body) return;
    this.theme = pageTheme();
    this.sheet = new CSSStyleSheet();
    this.sheet.replaceSync(paintCss(this.theme));
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.sheet];

    this.ui = createShadowHost('highlights', [tokensCss, controlsCss, highlightsCss]);
    const layer = document.createElement('div');
    layer.className = 'mh-layer';
    layer.dataset.theme = this.theme;
    layer.setAttribute('data-midaad-ui', '');
    this.ui.root.append(layer);

    this.highlighter = new Highlighter({
      layer: 'page',
      root: document.body,
      events: document,
      ui: layer,
      uiBoundary: this.ui.host,
      getSelection: () => document.getSelection(),
      pageMeta,
      theme: () => this.theme,
      settings: this.settings,
      store: this.store,
      watchMutations: true,
    });
    this.highlighter.start();
    this.stopNav = watchNavigation(() => {
      const url = normalizeUrl(location.href);
      if (url !== this.store.url) void this.store.load(url);
    });
    await this.store.load(normalizeUrl(location.href));
  }

  highlightSelection(): boolean {
    return this.highlighter?.highlightSelection() ?? false;
  }

  hasSelection(): boolean {
    return this.highlighter?.hasSelection() ?? false;
  }

  destroy() {
    this.highlighter?.destroy();
    this.highlighter = null;
    this.ui?.destroy();
    this.ui = null;
    this.stopNav?.();
    if (this.sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== this.sheet);
    this.sheet = null;
  }
}

function pageMeta() {
  const og = (p: string) => document.querySelector<HTMLMetaElement>(`meta[property="${p}"], meta[name="${p}"]`)?.content?.trim();
  const sample = (document.body?.innerText ?? '').slice(0, 3000);
  const declared = (document.documentElement.dir || document.body?.dir || '').toLowerCase();
  return {
    title: og('og:title') || document.title.trim() || location.hostname,
    siteName: og('og:site_name') || location.hostname.replace(/^www\./, ''),
    lang: document.documentElement.lang || undefined,
    dir: declared === 'rtl' || declared === 'ltr' ? (declared as 'rtl' | 'ltr') : detectDirection(sample),
  };
}

/** Is the page dark? Decides which paint and UI theme fits it. */
function pageTheme(): 'light' | 'dark' {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const nums = getComputedStyle(el).backgroundColor.match(/[0-9.]+/g)?.map(Number);
    if (!nums || nums.length < 3) continue;
    const alpha = nums[3] ?? 1;
    if (alpha < 0.5) continue;
    const [r, g, b] = nums.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.2 ? 'dark' : 'light';
  }
  return 'light';
}

/** Calls `onChange` after same-document navigations (history API, back/forward). */
function watchNavigation(onChange: () => void): () => void {
  let last = location.href;
  const check = () => {
    if (location.href === last) return;
    last = location.href;
    onChange();
  };
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  nav?.addEventListener('navigatesuccess', check);
  addEventListener('popstate', check);
  // Fallback for browsers without the Navigation API and for pushState without events.
  const timer = setInterval(check, 1500);
  return () => {
    nav?.removeEventListener('navigatesuccess', check);
    removeEventListener('popstate', check);
    clearInterval(timer);
  };
}

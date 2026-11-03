import { h, render } from 'preact';
import tokensCss from '../../shared/ui/tokens.css?inline';
import controlsCss from '../../shared/ui/controls.css?inline';
import articleCss from '../../shared/ui/article.css?inline';
import readerCss from './reader.css?inline';
import { sendToBackground } from '../../shared/messages';
import { loadFonts } from '../../shared/fonts';
import { fontsNeeded } from '../../shared/readerStyle';
import {
  DEFAULT_SETTINGS,
  getSettings,
  onSettingsChanged,
  updateReaderSettings,
  type ReaderSettings,
} from '../../shared/settings';
import { createShadowHost, type ShadowHost } from '../ui/shadowHost';
import { showToast } from '../ui/toast';
import { extractArticle, type Article } from './extract';
import { ReaderApp } from './ReaderApp';

const ALL_LATIN = ['literata', 'source-sans', 'atkinson', 'opendyslexic'];
const ALL_ARABIC = ['noto-naskh', 'amiri'];

/**
 * Owns the reader overlay's lifecycle. The page itself is only touched in two reversible ways:
 * the page's own scrollbar is hidden, and <body> is marked `inert` so keyboard focus stays in
 * the reader. Both are restored exactly on close.
 */
export class ReaderController {
  private ui: ShadowHost | null = null;
  private article: Article | null = null;
  private articleUrl = '';
  private settings: ReaderSettings = DEFAULT_SETTINGS.reader;
  private unsubscribe: (() => void) | null = null;
  private saveTimer = 0;
  private restore: (() => void) | null = null;

  get isOpen() {
    return this.ui !== null;
  }

  async toggle(): Promise<boolean> {
    if (this.isOpen) {
      this.close();
      return false;
    }
    return this.open();
  }

  async open(): Promise<boolean> {
    if (this.ui) return true;

    // Re-extract if the URL changed (single-page apps) or on first use.
    if (!this.article || this.articleUrl !== location.href) {
      this.article = extractArticle(document);
      this.articleUrl = location.href;
    }
    this.settings = (await getSettings()).reader;
    const article = this.article;
    if (!article) {
      showToast('Midaad couldn’t find an article to read on this page.', this.settings.theme === 'dark' ? 'dark' : 'light');
      return false;
    }

    // Load the chosen fonts before first paint to avoid a flash of fallback text, but wait at most 600 ms.
    await Promise.race([
      loadFonts(['literata', ...fontsNeeded(this.settings, article.hasArabic)], document.fonts, 'buffer'),
      new Promise((r) => setTimeout(r, 600)),
    ]);
    // Load the remaining fonts in the background so the font picker previews render correctly.
    void loadFonts([...ALL_LATIN, ...(article.hasArabic ? ALL_ARABIC : [])], document.fonts, 'buffer');

    this.ui = createShadowHost('reader', [tokensCss, controlsCss, articleCss, readerCss], { fullscreen: true });
    this.restore = lockPage();
    this.unsubscribe = onSettingsChanged((s) => {
      this.settings = s.reader;
      this.render();
    });
    this.render();
    return true;
  }

  close() {
    if (!this.ui) return;
    this.flushSave();
    render(null, this.ui.root);
    this.ui.destroy();
    this.ui = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.restore?.();
    this.restore = null;
  }

  destroy() {
    this.close();
  }

  private render() {
    if (!this.ui || !this.article) return;
    render(
      h(ReaderApp, {
        article: this.article,
        settings: this.settings,
        onSettingsChange: (patch) => this.changeSettings(patch),
        onResetSettings: () => this.changeSettings(DEFAULT_SETTINGS.reader),
        onClose: () => this.close(),
        onOpenOptions: () => void sendToBackground('ui/openOptions', { section: 'reading' }),
      }),
      this.ui.root,
    );
  }

  /** Apply instantly, persist shortly after (slider drags would otherwise write on every pixel). */
  private changeSettings(patch: Partial<ReaderSettings>) {
    this.settings = { ...this.settings, ...patch };
    this.render();
    void loadFonts(fontsNeeded(this.settings, this.article?.hasArabic ?? false), document.fonts, 'buffer');
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 250);
  }

  private flushSave() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    void updateReaderSettings(this.settings);
  }
}

/** Hide the page scrollbar and make the page inert while the reader is open. Returns an undo function. */
function lockPage(): () => void {
  const html = document.documentElement;
  const body = document.body as HTMLElement | null;
  const prevOverflow = html.style.getPropertyValue('overflow');
  const prevPriority = html.style.getPropertyPriority('overflow');
  const prevInert = body?.inert ?? false;
  const prevFocus = document.activeElement as HTMLElement | null;

  html.style.setProperty('overflow', 'hidden', 'important');
  if (body) body.inert = true; // our host lives on <html>, outside <body>, so it stays interactive

  return () => {
    if (prevOverflow) html.style.setProperty('overflow', prevOverflow, prevPriority);
    else html.style.removeProperty('overflow');
    if (body) body.inert = prevInert;
    prevFocus?.focus?.({ preventScroll: true });
  };
}

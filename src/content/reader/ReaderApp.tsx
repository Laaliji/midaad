import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MidaadMark } from '../../shared/ui/Brand';
import { TypographyControls } from '../../shared/ui/controls';
import { readerStyleVars } from '../../shared/readerStyle';
import type { ReaderSettings } from '../../shared/settings';
import { articleLabels } from '../../shared/i18n';
import type { Article } from './extract';

interface Props {
  article: Article;
  settings: ReaderSettings;
  onSettingsChange: (patch: Partial<ReaderSettings>) => void;
  onResetSettings: () => void;
  onClose: () => void;
  onOpenOptions: () => void;
  /** Called once the article body is in the DOM, with a container for highlight UI. */
  onArticleMount?: (body: HTMLDivElement, layer: HTMLDivElement) => void;
  /** Label of the button at the end of the article. */
  closeLabel?: string;
  /** Reading position to restore, 0..1. */
  initialProgress?: number;
  /** Reports the reading position while scrolling (throttled). */
  onProgress?: (progress: number) => void;
  /** A short note shown under the title. */
  notice?: string;
}

interface TocEntry {
  el: HTMLElement;
  text: string;
  level: number;
}

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ReaderApp({
  article,
  settings,
  onSettingsChange,
  onResetSettings,
  onClose,
  onOpenOptions,
  onArticleMount,
  closeLabel = 'Back to the original page',
  initialProgress = 0,
  onProgress,
  notice,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typoBtnRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const tocBtnRef = useRef<HTMLButtonElement>(null);
  const progressCb = useRef(onProgress);
  progressCb.current = onProgress;

  const [progress, setProgress] = useState(0);
  const [barHidden, setBarHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [toc, setToc] = useState<TocEntry[]>([]);

  // Mount the sanitized article body once.
  useLayoutEffect(() => {
    bodyRef.current?.replaceChildren(article.content.cloneNode(true));
    if (bodyRef.current && layerRef.current) onArticleMount?.(bodyRef.current, layerRef.current);
    setToc(buildToc(bodyRef.current));
  }, [article]);

  // Return to where you left off (documents from the Library).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || initialProgress <= 0.002) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = initialProgress * (el.scrollHeight - el.clientHeight);
    });
    return () => cancelAnimationFrame(frame);
  }, [article]);

  // Focus the scroller so Space, PageDown and the arrow keys scroll the article right away.
  useEffect(() => {
    scrollerRef.current?.focus({ preventScroll: true });
  }, []);

  // Scroll progress and an auto-hiding toolbar, throttled to animation frames.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let lastY = 0;
    let frame = 0;
    let reportTimer = 0;
    const update = () => {
      frame = 0;
      const max = el.scrollHeight - el.clientHeight;
      const y = el.scrollTop;
      const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 1;
      setProgress(p);
      clearTimeout(reportTimer);
      reportTimer = window.setTimeout(() => progressCb.current?.(p), 600);
      setScrolled(y > 8);
      if (Math.abs(y - lastY) > 6) {
        setBarHidden(y > lastY && y > 120);
        lastY = y;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(reportTimer);
    };
  }, []);

  // Panel: focus inside on open, return focus to its button on close, close on outside click.
  useEffect(() => {
    if (!panelOpen) return;
    panelRef.current?.querySelector<HTMLElement>('input:checked, button, input')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const path = e.composedPath();
      if (panelRef.current && !path.includes(panelRef.current) && !path.includes(typoBtnRef.current!)) closePanel(false);
    };
    const root = panelRef.current?.getRootNode() as ShadowRoot | undefined;
    root?.addEventListener('pointerdown', onPointerDown as EventListener);
    return () => root?.removeEventListener('pointerdown', onPointerDown as EventListener);
  }, [panelOpen]);

  function closePanel(restoreFocus = true) {
    setPanelOpen(false);
    if (restoreFocus) typoBtnRef.current?.focus();
  }

  // Contents panel: same focus and outside-click behaviour as the settings panel.
  useEffect(() => {
    if (!tocOpen) return;
    tocRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const path = e.composedPath();
      if (tocRef.current && !path.includes(tocRef.current) && !path.includes(tocBtnRef.current!)) setTocOpen(false);
    };
    const root = tocRef.current?.getRootNode() as ShadowRoot | undefined;
    root?.addEventListener('pointerdown', onPointerDown as EventListener);
    return () => root?.removeEventListener('pointerdown', onPointerDown as EventListener);
  }, [tocOpen]);

  function closeToc(restoreFocus = true) {
    setTocOpen(false);
    if (restoreFocus) tocBtnRef.current?.focus();
  }

  function goTo(entry: TocEntry) {
    setTocOpen(false);
    entry.el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    scrollerRef.current?.focus({ preventScroll: true });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (panelOpen) closePanel();
      else if (tocOpen) closeToc();
      else onClose();
    }
  }

  // In-article anchors (footnotes, table of contents) must resolve inside the shadow root.
  function onBodyClick(e: MouseEvent) {
    const a = (e.target as Element | null)?.closest?.('a');
    const href = a?.getAttribute('href');
    if (!a || !href?.startsWith('#') || href.length < 2) return;
    e.preventDefault();
    const id = decodeURIComponent(href.slice(1));
    const root = a.getRootNode() as ShadowRoot;
    const target = root.getElementById(id) ?? root.querySelector(`[name="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  const pct = Math.round(progress * 100);
  const minutesLeft = Math.ceil(article.minutes * (1 - progress));
  const vars = useMemo(() => readerStyleVars(settings), [settings]);
  const published = useMemo(() => formatDate(article.publishedTime, article.lang), [article]);
  const showBar = !barHidden || panelOpen || tocOpen;
  const labels = articleLabels(article.lang);

  return (
    <div
      class="mr"
      data-theme={settings.theme}
      role="dialog"
      aria-modal="true"
      aria-label={`Reader view: ${article.title}`}
      onKeyDown={onKeyDown}
    >
      <div
        class="mr-progress"
        dir={article.dir}
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div class="mr-progress__bar" style={{ transform: `scaleX(${progress})` }} />
      </div>

      <header class={`mr-bar${showBar ? '' : ' is-hidden'}${scrolled ? ' is-scrolled' : ''}`}>
        <div class="mr-bar__start">
          <MidaadMark size={22} />
          <span class="mr-bar__site" title={article.siteName}>
            {article.siteName}
          </span>
        </div>
        <div class="mr-bar__center" aria-hidden="true">
          {progress >= 0.995 ? 'Finished' : `${minutesLeft} min left`}
        </div>
        <div class="mr-bar__end">
          {toc.length >= 3 && (
            <button
              ref={tocBtnRef}
              type="button"
              class={`mr-btn${tocOpen ? ' is-active' : ''}`}
              aria-expanded={tocOpen}
              aria-controls="mr-toc"
              aria-label="Contents"
              title="Contents"
              onClick={() => {
                if (tocOpen) return closeToc();
                setPanelOpen(false);
                setTocOpen(true);
              }}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </button>
          )}
          <button
            ref={typoBtnRef}
            type="button"
            class={`mr-btn mr-btn--text${panelOpen ? ' is-active' : ''}`}
            aria-expanded={panelOpen}
            aria-controls="mr-panel"
            aria-label="Reading settings"
            title="Reading settings"
            onClick={() => {
              if (panelOpen) return closePanel();
              setTocOpen(false);
              setPanelOpen(true);
            }}
          >
            <span class="mr-aa" aria-hidden="true">
              <span>A</span>
              <span>a</span>
            </span>
          </button>
          <button type="button" class="mr-btn" aria-label="Close reader" title="Close reader (Esc)" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <div class="mr-scroller" ref={scrollerRef} tabIndex={-1}>
        <main class="mr-page">
          <article class="mw-article" dir={article.dir} lang={article.lang} style={vars}>
            <header class="mw-article__header">
              <p class="mw-article__kicker">{article.siteName}</p>
              <h1 class="mw-article__title">{article.title}</h1>
              {article.byline && <p class="mw-article__byline">{article.byline}</p>}
              <p class="mw-article__meta">
                <span>{labels.readingTime(article.minutes)}</span>
                <span>{labels.words(article.words)}</span>
                {published && <span>{published}</span>}
              </p>
              {notice && (
                <p class="mw-article__notice" role="note">
                  {notice}
                </p>
              )}
            </header>
            <div class="mw-article__rule" aria-hidden="true">
              <MidaadMark size={20} />
            </div>
            <div class="mw-article__body" ref={bodyRef} onClick={onBodyClick} />
            <footer class="mr-end">
              <div class="mw-article__rule" aria-hidden="true">
                <MidaadMark size={20} />
              </div>
              <button type="button" class="mr-end__btn" onClick={onClose}>
                {closeLabel}
              </button>
            </footer>
          </article>
        </main>
      </div>

      <div class="mh-layer" ref={layerRef} data-midaad-ui="" />

      {tocOpen && (
        <nav class="mr-panel mr-panel--toc" id="mr-toc" ref={tocRef} aria-label="Contents">
          <div class="mr-panel__head">
            <h2 class="mr-panel__title">Contents</h2>
          </div>
          <ol class="mr-toc" dir={article.dir} lang={article.lang}>
            {toc.map((t, i) => (
              <li key={i} class={`mr-toc__item mr-toc__item--${t.level}`}>
                <button type="button" class="mr-toc__link" dir="auto" onClick={() => goTo(t)}>
                  {t.text}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {panelOpen && (
        <div class="mr-panel" id="mr-panel" ref={panelRef} role="dialog" aria-label="Reading settings">
          <div class="mr-panel__head">
            <h2 class="mr-panel__title">Reading settings</h2>
            <button type="button" class="mr-link" onClick={onResetSettings}>
              Reset
            </button>
          </div>
          <TypographyControls settings={settings} onChange={onSettingsChange} compact showArabic={article.hasArabic} />
          <button type="button" class="mr-panel__more" onClick={onOpenOptions}>
            All settings
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/** Headings of the two top levels used in the article, for the Contents panel. */
function buildToc(body: HTMLElement | null): TocEntry[] {
  if (!body) return [];
  const all = Array.from(body.querySelectorAll<HTMLElement>('h1, h2, h3, h4'))
    .map((el) => ({ el, text: (el.textContent ?? '').trim().slice(0, 140), level: Number(el.tagName[1]) }))
    .filter((t) => t.text);
  const levels = [...new Set(all.map((t) => t.level))].sort().slice(0, 2);
  return all.filter((t) => levels.includes(t.level)).map((t) => ({ ...t, level: levels.indexOf(t.level) + 1 }));
}

function formatDate(iso: string | null, lang?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

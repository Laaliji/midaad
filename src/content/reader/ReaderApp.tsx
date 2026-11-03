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
}

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ReaderApp({ article, settings, onSettingsChange, onResetSettings, onClose, onOpenOptions }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typoBtnRef = useRef<HTMLButtonElement>(null);

  const [progress, setProgress] = useState(0);
  const [barHidden, setBarHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // Mount the sanitized article body once.
  useLayoutEffect(() => {
    bodyRef.current?.replaceChildren(article.content.cloneNode(true));
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
    const update = () => {
      frame = 0;
      const max = el.scrollHeight - el.clientHeight;
      const y = el.scrollTop;
      setProgress(max > 0 ? Math.min(1, Math.max(0, y / max)) : 1);
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

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (panelOpen) closePanel();
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
  const showBar = !barHidden || panelOpen;
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
          <button
            ref={typoBtnRef}
            type="button"
            class={`mr-btn mr-btn--text${panelOpen ? ' is-active' : ''}`}
            aria-expanded={panelOpen}
            aria-controls="mr-panel"
            aria-label="Reading settings"
            title="Reading settings"
            onClick={() => (panelOpen ? closePanel() : setPanelOpen(true))}
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
                Back to the original page
              </button>
            </footer>
          </article>
        </main>
      </div>

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

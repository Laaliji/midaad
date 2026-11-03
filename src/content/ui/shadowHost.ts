/**
 * Creates an isolated UI root on the page: a host element on <html> (not <body>, whose styles,
 * transforms or `inert` could affect it) with a closed shadow root and constructable stylesheets.
 * Constructable stylesheets are not blocked by a page's CSP `style-src`.
 */

const sheetCache = new Map<string, CSSStyleSheet>();

function sheet(css: string): CSSStyleSheet {
  let s = sheetCache.get(css);
  if (!s) {
    s = new CSSStyleSheet();
    s.replaceSync(css);
    sheetCache.set(css, s);
  }
  return s;
}

export interface ShadowHost {
  host: HTMLElement;
  root: ShadowRoot;
  destroy(): void;
}

/** Events that should not leak from our UI to page-level handlers (shortcuts, scroll-jacking...). */
const ISOLATED_EVENTS = [
  'keydown', 'keyup', 'keypress', 'wheel', 'touchstart', 'touchmove',
  'pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'copy', 'selectstart',
] as const;

export function createShadowHost(name: string, css: string[], opts: { fullscreen?: boolean } = {}): ShadowHost {
  const host = document.createElement('div');
  host.setAttribute('data-midaad-host', name);
  const st = host.style;
  st.setProperty('all', 'initial', 'important');
  st.setProperty('position', 'fixed', 'important');
  st.setProperty('z-index', '2147483647', 'important');
  st.setProperty('display', 'block', 'important');
  if (opts.fullscreen) {
    st.setProperty('inset', '0', 'important');
  } else {
    st.setProperty('top', '0', 'important');
    st.setProperty('left', '0', 'important');
    st.setProperty('width', '0', 'important');
    st.setProperty('height', '0', 'important');
    st.setProperty('overflow', 'visible', 'important');
  }

  const root = host.attachShadow({ mode: 'closed' });
  root.adoptedStyleSheets = css.map(sheet);
  for (const type of ISOLATED_EVENTS) host.addEventListener(type, stop);
  document.documentElement.append(host);

  return {
    host,
    root,
    destroy() {
      for (const type of ISOLATED_EVENTS) host.removeEventListener(type, stop);
      host.remove();
    },
  };
}

function stop(e: Event) {
  e.stopPropagation();
}

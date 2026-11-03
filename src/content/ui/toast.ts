import tokensCss from '../../shared/ui/tokens.css?inline';
import { createShadowHost } from './shadowHost';

const css = `
.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 12px;
  max-width: min(440px, calc(100vw - 32px));
  padding: 12px 16px 12px 14px; border-radius: 14px;
  background: var(--mw-surface); color: var(--mw-text); border: 1px solid var(--mw-rule);
  box-shadow: var(--mw-shadow);
  direction: ltr;
  font: 500 14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
  animation: in 220ms cubic-bezier(.2,.7,.2,1) both;
}
.toast.out { animation: out 180ms ease-in both; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mw-progress); flex: none; }
@keyframes in { from { opacity: 0; transform: translate(-50%, 10px); } }
@keyframes out { to { opacity: 0; transform: translate(-50%, 6px); } }
@media (prefers-reduced-motion: reduce) { .toast, .toast.out { animation: none; } }
`;

let current: (() => void) | null = null;

/** A small, polite, auto-dismissing message at the bottom of the page. */
export function showToast(message: string, theme: 'light' | 'dark' = 'light', ms = 3800) {
  current?.();
  const ui = createShadowHost('toast', [tokensCss, css]);
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.theme = theme;
  el.setAttribute('role', 'status');
  el.innerHTML = '<span class="dot"></span><span class="msg"></span>';
  el.querySelector('.msg')!.textContent = message;
  ui.root.append(el);

  let timer = window.setTimeout(dismiss, ms);
  function dismiss() {
    clearTimeout(timer);
    el.classList.add('out');
    el.addEventListener('animationend', () => ui.destroy(), { once: true });
    timer = window.setTimeout(() => ui.destroy(), 300); // in case animations are disabled
    if (current === dismiss) current = null;
  }
  current = dismiss;
}

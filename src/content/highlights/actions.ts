/**
 * Extra actions in the selection toolbar, after the colours and "Add note".
 * Adding one ("Explain", "Read aloud", "Make a flashcard"...) is one more entry here.
 */
import { showToast } from '../ui/toast';

export interface SelectionContext {
  /** The selected text, whitespace collapsed. */
  text: string;
  range: Range;
  theme: 'light' | 'dark';
}

export interface SelectionAction {
  id: string;
  label: string;
  /** SVG path data, drawn as a 24×24 stroked icon. */
  icon: string;
  run(ctx: SelectionContext): void | Promise<void>;
}

export const selectionActions: SelectionAction[] = [
  {
    id: 'copy',
    label: 'Copy text',
    icon: 'M9 9h10v11H9z M5 15V4h10',
    async run({ text, theme }) {
      const ok = await copyText(text);
      showToast(ok ? 'Copied' : 'Couldn’t copy on this page', theme, 1600);
    },
  },
];

/** Clipboard API where available (secure pages), otherwise the legacy copy command. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.documentElement.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

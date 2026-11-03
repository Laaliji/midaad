import { fontStack } from './fonts';
import type { ReaderSettings } from './settings';

/** CSS custom properties consumed by article.css. */
export function readerStyleVars(s: ReaderSettings): Record<string, string> {
  return {
    '--mr-font': fontStack(s.font, s.arabicFont),
    '--mr-size': `${s.fontSize}px`,
    '--mr-lh': String(s.lineHeight),
    '--mr-measure': `${s.contentWidth}ch`,
  };
}

/** Font ids that must be loaded for these settings (Arabic only when the text needs it). */
export function fontsNeeded(s: ReaderSettings, needsArabic: boolean): string[] {
  const ids: string[] = [s.font];
  if (needsArabic) ids.push(s.arabicFont);
  return ids.filter((id) => id !== 'system');
}

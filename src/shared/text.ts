/**
 * Language-aware text utilities. Shared so future features (text-to-speech word tracking,
 * flashcards) segment text exactly the way the reader does.
 */

/**
 * Average silent reading speeds (words per minute) by language, from Trauzettel-Klosinski
 * & Dietz (2012), "Standardized Assessment of Reading Performance". Arabic words carry
 * more morphemes, so they read more slowly.
 */
const WPM: Record<string, number> = {
  ar: 138, he: 187, en: 228, fr: 195, de: 179, es: 218, it: 188, nl: 202,
  pt: 181, ru: 184, tr: 166, pl: 166, sv: 199, fi: 161, zh: 158, ja: 193,
};
const DEFAULT_WPM = 200;

// Arabic, Arabic Supplement, Arabic Extended-A, Presentation Forms-A and -B
const ARABIC_RANGES = '\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
const ARABIC_SCRIPT = new RegExp(`[${ARABIC_RANGES}]`, 'g');
const ARABIC_TEST = new RegExp(`[${ARABIC_RANGES}]`);
const HEBREW_SCRIPT = new RegExp('[\\u0590-\\u05FF]', 'g');
const LATIN_LETTER = new RegExp('[A-Za-z\\u00C0-\\u024F]', 'g');

export function baseLang(lang: string | null | undefined): string {
  return (lang ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/** Count words with Intl.Segmenter (handles Arabic clitics, CJK and so on), with a whitespace fallback. */
export function countWords(text: string, lang?: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(lang || undefined, { granularity: 'word' });
    let n = 0;
    for (const s of seg.segment(text)) if (s.isWordLike) n++;
    return n;
  }
  return text.split(/\s+/).filter(Boolean).length;
}

export function readingMinutes(words: number, lang?: string): number {
  const wpm = WPM[baseLang(lang)] ?? DEFAULT_WPM;
  return Math.max(1, Math.round(words / wpm));
}

/** Guess the dominant script of a text sample: is it right-to-left? */
export function detectDirection(text: string): 'rtl' | 'ltr' {
  const sample = text.slice(0, 4000);
  const rtl = (sample.match(ARABIC_SCRIPT)?.length ?? 0) + (sample.match(HEBREW_SCRIPT)?.length ?? 0);
  const ltr = sample.match(LATIN_LETTER)?.length ?? 0;
  return rtl > ltr ? 'rtl' : 'ltr';
}

/** Guess a language code when the page doesn't declare one (only distinguishes what we need). */
export function guessLang(text: string): string | undefined {
  const sample = text.slice(0, 4000);
  const arabic = sample.match(ARABIC_SCRIPT)?.length ?? 0;
  const latin = sample.match(LATIN_LETTER)?.length ?? 0;
  if (arabic > latin) return 'ar';
  if (latin > 0) return 'en';
  return undefined;
}

export function containsArabic(text: string): boolean {
  return ARABIC_TEST.test(text);
}

import { FONT_FACES } from './fonts.generated';
import type { ArabicFontId, LatinFontId } from './settings';

/**
 * Font catalog. Families get a "Midaad …" prefix so they never collide with a page's own fonts.
 * Latin fonts come first in every stack, so Arabic glyphs fall through to the chosen Arabic font
 * one glyph at a time. Mixed Arabic and English text renders correctly with no script detection.
 */

interface FontInfo {
  label: string;
  /** Shorter label for tight spaces (compact pickers). */
  short?: string;
  note: string;
  /** Family name used in CSS; null for system fonts (nothing to load). */
  family: string | null;
  fallback: string;
}

export const LATIN_FONTS: Record<LatinFontId, FontInfo> = {
  literata: { label: 'Literata', note: 'Book serif, made for long reads', family: 'Midaad Literata', fallback: 'Georgia, serif' },
  'source-sans': { label: 'Source Sans', note: 'Clean, neutral sans', family: 'Midaad Source Sans', fallback: 'system-ui, sans-serif' },
  atkinson: { label: 'Atkinson Hyperlegible', short: 'Atkinson', note: 'Distinct letterforms for low vision', family: 'Midaad Atkinson', fallback: 'Verdana, sans-serif' },
  opendyslexic: { label: 'OpenDyslexic', note: 'Weighted bottoms to help with dyslexia', family: 'Midaad OpenDyslexic', fallback: 'Comic Sans MS, sans-serif' },
  system: { label: 'System', note: 'Your device’s interface font', family: null, fallback: 'system-ui, sans-serif' },
};

export const ARABIC_FONTS: Record<ArabicFontId, FontInfo> = {
  'noto-naskh': { label: 'Noto Naskh', note: 'Clear modern Naskh', family: 'Midaad Naskh', fallback: '' },
  amiri: { label: 'Amiri', note: 'Classical book Naskh', family: 'Midaad Amiri', fallback: '' },
  system: { label: 'System', note: 'Device default', family: null, fallback: '' },
};

const q = (f: string) => `"${f}"`;

/** Full CSS font-family stack for a Latin + Arabic font pair. */
export function fontStack(latin: LatinFontId, arabic: ArabicFontId): string {
  const l = LATIN_FONTS[latin];
  const a = ARABIC_FONTS[arabic];
  const parts = [l.family && q(l.family), a.family && q(a.family), l.fallback, 'system-ui', 'sans-serif'];
  return parts.filter(Boolean).join(', ');
}

/** Font id → the family name used by the generated faces. */
const FAMILY_BY_ID: Record<string, string> = {
  literata: 'Midaad Literata',
  'source-sans': 'Midaad Source Sans',
  atkinson: 'Midaad Atkinson',
  opendyslexic: 'Midaad OpenDyslexic',
  'noto-naskh': 'Midaad Naskh',
  amiri: 'Midaad Amiri',
};

const loaded = new Set<string>();

/**
 * Register the faces of the given fonts with a FontFaceSet.
 * - mode 'url': lazy, browser downloads on use (extension pages).
 * - mode 'buffer': fetched by the extension and passed as bytes (content scripts), so a page's
 *   Content-Security-Policy `font-src` can't block the reader's fonts.
 */
export async function loadFonts(ids: string[], target: FontFaceSet, mode: 'url' | 'buffer'): Promise<void> {
  const todo = FONT_FACES.filter((f) => ids.includes(f.font) && !loaded.has(f.file));
  await Promise.all(
    todo.map(async (spec) => {
      loaded.add(spec.file);
      const family = FAMILY_BY_ID[spec.font];
      if (!family) return;
      const url = chrome.runtime.getURL(`fonts/${spec.file}`);
      try {
        const source = mode === 'url' ? `url("${url}") format("woff2")` : await (await fetch(url)).arrayBuffer();
        const face = new FontFace(family, source, {
          weight: spec.weight,
          style: spec.style,
          unicodeRange: spec.unicodeRange,
          display: 'swap',
        });
        target.add(face);
        if (mode === 'buffer') await face.load();
      } catch (err) {
        loaded.delete(spec.file);
        console.warn('[Midaad] font failed to load', spec.file, err);
      }
    }),
  );
}

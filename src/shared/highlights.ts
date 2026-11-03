/**
 * Highlight data model, shared by the background (storage), content scripts (anchoring, painting)
 * and, later, the side panel.
 */

export type HighlightColor = 'honey' | 'sage' | 'clay' | 'dusk';

export interface HighlightColorInfo {
  id: HighlightColor;
  label: string;
  /** Solid swatch shown in toolbars and lists. */
  swatch: string;
  /** Translucent paint behind text on light and dark backgrounds. */
  light: string;
  dark: string;
}

/**
 * Four earthy inks that stay distinguishable from each other (and for common colour-vision
 * deficiencies, by lightness as well as hue). Paints are translucent so text keeps its contrast.
 */
export const HIGHLIGHT_COLORS: readonly HighlightColorInfo[] = [
  { id: 'honey', label: 'Honey', swatch: '#e2b04a', light: 'rgb(236 190 84 / 0.45)', dark: 'rgb(226 176 74 / 0.34)' },
  { id: 'sage', label: 'Sage', swatch: '#9aa77a', light: 'rgb(164 180 120 / 0.45)', dark: 'rgb(164 180 120 / 0.32)' },
  { id: 'clay', label: 'Clay', swatch: '#c98a5e', light: 'rgb(214 146 102 / 0.40)', dark: 'rgb(214 146 102 / 0.34)' },
  { id: 'dusk', label: 'Dusk', swatch: '#8ea3b4', light: 'rgb(142 168 190 / 0.45)', dark: 'rgb(142 168 190 / 0.34)' },
];

export const COLOR_IDS = HIGHLIGHT_COLORS.map((c) => c.id);

export function isHighlightColor(v: unknown): v is HighlightColor {
  return typeof v === 'string' && (COLOR_IDS as string[]).includes(v);
}

export function colorInfo(id: HighlightColor): HighlightColorInfo {
  return HIGHLIGHT_COLORS.find((c) => c.id === id) ?? HIGHLIGHT_COLORS[0]!;
}

/**
 * A W3C-style text quote selector. `exact`, `prefix` and `suffix` are stored with all whitespace
 * removed, so the same passage matches in reader view and on the original page even though the
 * two lay out spaces and line breaks differently.
 */
export interface TextQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface Highlight {
  id: string;
  /** Normalized page URL (see shared/url.ts). */
  url: string;
  quote: TextQuote;
  /** Where the passage starts, as a fraction of the page's text. Breaks ties between repeated quotes. */
  position: number;
  /** The highlighted text as the reader saw it (whitespace collapsed), for lists and export. */
  text: string;
  color: HighlightColor;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface PageMeta {
  url: string;
  title: string;
  siteName: string;
  lang?: string;
  dir?: 'ltr' | 'rtl';
}

export interface PageRecord extends PageMeta {
  createdAt: number;
  updatedAt: number;
}

export type HighlightPatch = Partial<Pick<Highlight, 'color' | 'note'>>;

export const LIMITS = {
  /** Longest passage we store (characters). Longer selections are refused with a message. */
  text: 20_000,
  note: 10_000,
  context: 32,
} as const;

/** Random id that works on plain-http pages too (crypto.randomUUID needs a secure context). */
export function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

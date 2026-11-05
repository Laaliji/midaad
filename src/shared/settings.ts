/**
 * User settings, stored in chrome.storage.local (never `sync`: nothing leaves the browser).
 * Every extension context can read them and subscribe to changes, so the reader
 * restyles itself instantly when you change something in the options page.
 */

import { isHighlightColor, type HighlightColor } from './highlights';

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type LatinFontId = 'literata' | 'source-sans' | 'atkinson' | 'opendyslexic' | 'system';
export type ArabicFontId = 'noto-naskh' | 'amiri' | 'system';

export interface ReaderSettings {
  theme: ReaderTheme;
  font: LatinFontId;
  arabicFont: ArabicFontId;
  /** Base font size in CSS px. */
  fontSize: number;
  /** Unitless line-height (Arabic text gets a small automatic boost). */
  lineHeight: number;
  /** Max line length, in `ch` units of the reading font. */
  contentWidth: number;
}

export interface HighlightSettings {
  /** Colour used by the shortcut, the right-click menu and "Add note". */
  defaultColor: HighlightColor;
  /** Show the small toolbar when you select text on a page where Midaad is active. */
  selectionToolbar: boolean;
}

export interface Settings {
  version: 1;
  reader: ReaderSettings;
  highlights: HighlightSettings;
}

export const READER_LIMITS = {
  fontSize: { min: 14, max: 30, step: 1 },
} as const;

export const LINE_HEIGHTS = [
  { value: 1.45, label: 'Compact' },
  { value: 1.65, label: 'Normal' },
  { value: 1.85, label: 'Relaxed' },
  { value: 2.1, label: 'Airy' },
] as const;

export const CONTENT_WIDTHS = [
  { value: 56, label: 'Narrow' },
  { value: 66, label: 'Medium' },
  { value: 78, label: 'Wide' },
] as const;

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  reader: {
    theme: 'light',
    font: 'literata',
    arabicFont: 'noto-naskh',
    fontSize: 19,
    lineHeight: 1.65,
    contentWidth: 66,
  },
  highlights: {
    defaultColor: 'honey',
    selectionToolbar: true,
  },
};

const KEY = 'settings';

/** Merge stored data over defaults so new settings fields always have a value. */
export function normalizeSettings(raw: unknown): Settings {
  const stored = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Settings>;
  const reader = { ...DEFAULT_SETTINGS.reader, ...(stored.reader ?? {}) };
  reader.fontSize = clamp(Math.round(Number(reader.fontSize)) || 19, READER_LIMITS.fontSize.min, READER_LIMITS.fontSize.max);
  reader.lineHeight = clamp(Number(reader.lineHeight) || 1.65, 1.2, 2.6);
  reader.contentWidth = clamp(Number(reader.contentWidth) || 66, 40, 100);
  const hl = { ...DEFAULT_SETTINGS.highlights, ...(stored.highlights ?? {}) };
  if (!isHighlightColor(hl.defaultColor)) hl.defaultColor = DEFAULT_SETTINGS.highlights.defaultColor;
  hl.selectionToolbar = hl.selectionToolbar !== false;
  return { version: 1, reader, highlights: hl };
}

export async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(KEY);
  return normalizeSettings(data[KEY]);
}

export async function updateReaderSettings(patch: Partial<ReaderSettings>): Promise<Settings> {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, reader: { ...current.reader, ...patch } });
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function updateHighlightSettings(patch: Partial<HighlightSettings>): Promise<Settings> {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, highlights: { ...current.highlights, ...patch } });
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function resetReaderSettings(): Promise<Settings> {
  const next = { ...(await getSettings()), reader: DEFAULT_SETTINGS.reader };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && KEY in changes) cb(normalizeSettings(changes[KEY]?.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

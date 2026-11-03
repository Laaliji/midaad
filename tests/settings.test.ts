import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings';

describe('normalizeSettings', () => {
  it('returns defaults for empty or garbage storage', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps stored values and fills in missing fields', () => {
    const s = normalizeSettings({ reader: { theme: 'dark', fontSize: 22 } });
    expect(s.reader.theme).toBe('dark');
    expect(s.reader.fontSize).toBe(22);
    expect(s.reader.font).toBe(DEFAULT_SETTINGS.reader.font);
  });

  it('clamps out-of-range numbers', () => {
    const s = normalizeSettings({ reader: { fontSize: 400, lineHeight: 0.2, contentWidth: 5 } });
    expect(s.reader.fontSize).toBe(30);
    expect(s.reader.lineHeight).toBe(1.2);
    expect(s.reader.contentWidth).toBe(40);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../src/shared/url';

describe('normalizeUrl', () => {
  it('drops the hash, tracking parameters and a trailing slash', () => {
    expect(normalizeUrl('https://Example.com/post/?utm_source=x&fbclid=y#section-2')).toBe('https://example.com/post');
  });

  it('keeps meaningful query parameters, sorted', () => {
    expect(normalizeUrl('https://example.com/read?page=2&id=7&utm_medium=email')).toBe('https://example.com/read?id=7&page=2');
  });

  it('keeps the root path and leaves non-web URLs alone', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    expect(normalizeUrl('file:///C:/notes/a.html#x')).toBe('file:///C:/notes/a.html');
    expect(normalizeUrl('not a url')).toBe('not a url');
  });

  it('treats Arabic paths consistently', () => {
    const a = normalizeUrl('https://example.com/مقالة/?utm_campaign=1');
    const b = normalizeUrl('https://example.com/%D9%85%D9%82%D8%A7%D9%84%D8%A9');
    expect(a).toBe(b);
  });
});

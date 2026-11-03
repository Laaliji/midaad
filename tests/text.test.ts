import { describe, expect, it } from 'vitest';
import { containsArabic, countWords, detectDirection, guessLang, readingMinutes } from '../src/shared/text';
import { articleLabels } from '../src/shared/i18n';

describe('countWords', () => {
  it('counts English words, ignoring punctuation', () => {
    expect(countWords('Slow reading, as it turns out, matters.', 'en')).toBe(7);
  });
  it('counts Arabic words', () => {
    expect(countWords('القراءة المتأنية ليست بطئًا لذاته.', 'ar')).toBe(5);
  });
});

describe('readingMinutes', () => {
  it('uses a slower rate for Arabic than for English', () => {
    expect(readingMinutes(1380, 'ar')).toBe(10); // 138 wpm
    expect(readingMinutes(1380, 'en-GB')).toBe(6); // 228 wpm
  });
  it('never returns less than one minute', () => {
    expect(readingMinutes(3, 'en')).toBe(1);
  });
});

describe('direction and language detection', () => {
  it('detects RTL for Arabic text, even with some English words', () => {
    expect(detectDirection('نقرأ اليوم كلمات أكثر مع كلمة Readability')).toBe('rtl');
    expect(guessLang('نقرأ اليوم كلمات أكثر')).toBe('ar');
  });
  it('detects LTR for English', () => {
    expect(detectDirection('We read more words than ever')).toBe('ltr');
  });
  it('containsArabic is stable across calls (no global regex state)', () => {
    expect(containsArabic('hello مداد')).toBe(true);
    expect(containsArabic('hello مداد')).toBe(true);
    expect(containsArabic('hello')).toBe(false);
  });
});

describe('Arabic labels use correct plural forms', () => {
  const ar = articleLabels('ar');
  it.each([
    [1, 'قراءة في دقيقة'],
    [2, 'قراءة في دقيقتين'],
    [5, 'قراءة في 5 دقائق'],
    [11, 'قراءة في 11 دقيقة'],
  ])('%i minutes → %s', (n, label) => expect(ar.readingTime(n)).toBe(label));

  it('falls back to English for other languages', () => {
    expect(articleLabels('fr').readingTime(3)).toBe('3 min read');
    expect(articleLabels(undefined).words(1)).toBe('1 word');
  });
});

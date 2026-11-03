/**
 * Article-language labels for the reader's metadata line. The interface chrome stays English
 * for now, but text inside the article follows the article's language, so mixed-direction text
 * like "words 215" never appears in an Arabic article. Arabic plural forms follow Intl.PluralRules.
 */
import { baseLang } from './text';

type Labels = { readingTime: (min: number) => string; words: (n: number) => string };

const arPlural = new Intl.PluralRules('ar');
const num = (n: number) => n.toLocaleString('en');

const AR: Labels = {
  readingTime: (m) => {
    switch (arPlural.select(m)) {
      case 'one': return 'قراءة في دقيقة';
      case 'two': return 'قراءة في دقيقتين';
      case 'few': return `قراءة في ${num(m)} دقائق`;
      default: return `قراءة في ${num(m)} دقيقة`;
    }
  },
  words: (n) => {
    switch (arPlural.select(n)) {
      case 'one': return 'كلمة واحدة';
      case 'two': return 'كلمتان';
      case 'few': return `${num(n)} كلمات`;
      default: return `${num(n)} كلمة`;
    }
  },
};

const EN: Labels = {
  readingTime: (m) => `${num(m)} min read`,
  words: (n) => `${num(n)} ${n === 1 ? 'word' : 'words'}`,
};

export function articleLabels(lang: string | undefined): Labels {
  return baseLang(lang) === 'ar' ? AR : EN;
}

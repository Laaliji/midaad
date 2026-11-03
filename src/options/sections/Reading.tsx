import { useMemo, useState } from 'preact/hooks';
import { MidaadMark } from '../../shared/ui/Brand';
import { Segmented, TypographyControls } from '../../shared/ui/controls';
import { useSettings } from '../../shared/ui/hooks/useSettings';
import { readerStyleVars } from '../../shared/readerStyle';
import { DEFAULT_SETTINGS } from '../../shared/settings';

const SAMPLES = {
  en: {
    dir: 'ltr' as const,
    lang: 'en',
    kicker: 'Essay',
    title: 'The quiet art of reading slowly',
    meta: ['4 min read', '812 words'],
    body: [
      'Some pages ask to be skimmed. Others reward you for staying a little longer, for letting a sentence finish its work before you move to the next one.',
      'A good reading view gets out of the way: a comfortable measure of about sixty-six characters, generous spacing, and type that was drawn for long passages rather than headlines.',
    ],
    quote: 'A sentence read slowly is a sentence read twice.',
  },
  ar: {
    dir: 'rtl' as const,
    lang: 'ar',
    kicker: 'مقالة',
    title: 'فنّ القراءة على مهل',
    meta: ['٤ دقائق قراءة', '٥٢٠ كلمة'],
    body: [
      'بعض الصفحات تُقرأ على عجل، وبعضها يكافئك إن منحتها وقتًا أطول، وتركت الجملة تُتمّ عملها قبل أن تنتقل إلى ما بعدها.',
      'واجهة القراءة الجيدة لا تزاحم النص: سطرٌ بطولٍ مريح، ومسافاتٌ رحبة، وخطٌّ صُمّم للفقرات الطويلة لا للعناوين وحدها.',
    ],
    quote: 'المداد أبقى من الذاكرة.',
  },
};

export function ReadingSection() {
  const { settings, updateReader } = useSettings();
  const [sample, setSample] = useState<'en' | 'ar'>('en');
  const s = SAMPLES[sample];
  const vars = useMemo(() => readerStyleVars(settings.reader), [settings.reader]);

  return (
    <section class="op-section" aria-labelledby="reading-h">
      <header class="op-section__head">
        <div>
          <h1 id="reading-h">Reading</h1>
          <p class="op-lede">
            How articles look in reader view. Changes apply instantly, including to any reader view open in another tab.
          </p>
        </div>
        <button type="button" class="op-btn op-btn--ghost" onClick={() => updateReader(DEFAULT_SETTINGS.reader)}>
          Reset to defaults
        </button>
      </header>

      <div class="op-reading">
        <div class="op-card op-card--controls">
          <TypographyControls settings={settings.reader} onChange={updateReader} />
        </div>

        <div class="op-preview">
          <div class="op-preview__bar">
            <span class="op-preview__label">Preview</span>
            <Segmented
              label="Preview language"
              hideLabel
              value={sample}
              options={[
                { value: 'en', label: 'English' },
                { value: 'ar', label: 'العربية' },
              ]}
              onChange={setSample}
            />
          </div>
          <div class="op-preview__page" data-theme={settings.reader.theme}>
            <article class="mw-article" dir={s.dir} lang={s.lang} style={vars}>
              <p class="mw-article__kicker">{s.kicker}</p>
              <h2 class="mw-article__title">{s.title}</h2>
              <p class="mw-article__meta">
                {s.meta.map((m) => (
                  <span key={m}>{m}</span>
                ))}
              </p>
              <div class="mw-article__rule" aria-hidden="true">
                <MidaadMark size={18} />
              </div>
              <div class="mw-article__body">
                <p>{s.body[0]}</p>
                <blockquote>
                  <p>{s.quote}</p>
                </blockquote>
                <p>{s.body[1]}</p>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

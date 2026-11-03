import { useEffect, useState } from 'preact/hooks';
import { Wordmark } from '../shared/ui/Brand';
import { ReadingSection } from './sections/Reading';
import { ShortcutsSection } from './sections/Shortcuts';
import { AboutSection } from './sections/About';
import { Welcome } from './sections/Welcome';

const SECTIONS = [
  { id: 'reading', label: 'Reading', icon: 'M4 5.5C6.5 4 9.5 4 12 6c2.5-2 5.5-2 8-.5V19c-2.5-1.5-5.5-1.5-8 .5-2.5-2-5.5-2-8-.5z M12 6v13.5' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'M3 7h18v10H3z M7 11h.01 M11 11h.01 M15 11h.01 M7 14h10' },
  { id: 'about', label: 'About & privacy', icon: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2 2 4-4' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

function sectionFromHash(): SectionId {
  const h = location.hash.slice(1);
  return (SECTIONS.find((s) => s.id === h)?.id ?? 'reading') as SectionId;
}

export function App() {
  const [section, setSection] = useState<SectionId>(sectionFromHash);
  const [welcome, setWelcome] = useState(location.hash === '#welcome');

  useEffect(() => {
    const onHash = () => setSection(sectionFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div class="op">
      <aside class="op-side">
        <div class="op-brand">
          <Wordmark size={30} />
          <p class="op-tagline">Read · Highlight · Grow</p>
        </div>
        <nav class="op-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              class="op-nav__item"
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => setWelcome(false)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d={s.icon} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              {s.label}
            </a>
          ))}
        </nav>
        <p class="op-side__foot">
          <span class="op-dot" aria-hidden="true" /> Stored only in this browser
        </p>
      </aside>

      <main class="op-main" id="main">
        {welcome && <Welcome onDismiss={() => setWelcome(false)} />}
        {section === 'reading' && <ReadingSection />}
        {section === 'shortcuts' && <ShortcutsSection />}
        {section === 'about' && <AboutSection />}
      </main>
    </div>
  );
}

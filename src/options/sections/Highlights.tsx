import { useEffect, useState } from 'preact/hooks';
import { Switch } from '../../shared/ui/controls';
import { useSettings } from '../../shared/ui/hooks/useSettings';
import { HIGHLIGHT_COLORS } from '../../shared/highlights';
import { sendToBackground } from '../../shared/messages';

const ALL_URLS = { origins: ['<all_urls>'] };

export function HighlightsSection() {
  const { settings, updateHighlights } = useSettings();
  const [auto, setAuto] = useState<boolean | null>(null);
  const [stats, setStats] = useState<{ highlights: number; notes: number; pages: number } | null>(null);

  useEffect(() => {
    const refresh = () => void chrome.permissions.contains(ALL_URLS).then(setAuto);
    refresh();
    chrome.permissions.onAdded.addListener(refresh);
    chrome.permissions.onRemoved.addListener(refresh);
    void sendToBackground('highlights/stats').then(setStats).catch(() => {});
    return () => {
      chrome.permissions.onAdded.removeListener(refresh);
      chrome.permissions.onRemoved.removeListener(refresh);
    };
  }, []);

  async function toggleAuto(on: boolean) {
    // permissions.request must run directly from the click, before any other await.
    const ok = on ? await chrome.permissions.request(ALL_URLS) : await chrome.permissions.remove(ALL_URLS);
    if (ok) setAuto(on);
  }

  const name = 'default-color';

  return (
    <section class="op-section" aria-labelledby="highlights-h">
      <header class="op-section__head">
        <div>
          <h1 id="highlights-h">Highlights</h1>
          <p class="op-lede">
            Select text on a page or in reader view, then pick a colour. Click a highlight to recolour it, add a note, or
            remove it. Highlights made in reader view also appear on the original page.
          </p>
        </div>
      </header>

      <div class="op-stack">
        <div class="op-card">
          <fieldset class="op-colors">
            <legend class="op-h2">Default colour</legend>
            <p class="op-muted op-small">
              Used by <kbd class="op-kbd">Alt</kbd>+<kbd class="op-kbd">H</kbd>, the right-click menu and “Add note”.
            </p>
            <div class="op-colors__list">
              {HIGHLIGHT_COLORS.map((c) => (
                <label class="op-color" key={c.id}>
                  <input
                    type="radio"
                    name={name}
                    checked={settings.highlights.defaultColor === c.id}
                    onChange={() => updateHighlights({ defaultColor: c.id })}
                  />
                  <span class="op-color__chip">
                    <span class="op-color__dot" style={{ background: c.swatch }} aria-hidden="true" />
                    <span class="op-color__sample" style={{ background: c.light }}>
                      {c.label}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <hr class="op-rule" />

          <Switch
            label="Show the toolbar when I select text"
            description="When this is off, highlight with Alt+H or the right-click menu instead."
            checked={settings.highlights.selectionToolbar}
            onChange={(v) => updateHighlights({ selectionToolbar: v })}
          />
        </div>

        <div class="op-card">
          <Switch
            label="Restore highlights automatically"
            description="Show your highlights on every visit, without clicking Midaad first. This needs access to the pages you visit, so the browser will ask. Midaad only reads a page to place your highlights, and nothing leaves this browser."
            checked={!!auto}
            onChange={(v) => void toggleAuto(v)}
          />
          <p class="op-status" data-on={auto ? '' : undefined}>
            <span class="op-dot" aria-hidden="true" />
            {auto === null
              ? 'Checking…'
              : auto
                ? 'On: highlights reappear when you return to a page.'
                : 'Off: highlights appear once you click Midaad, press a shortcut, or use the right-click menu on that page.'}
          </p>
        </div>

        {stats && (
          <p class="op-hint" aria-live="polite">
            Saved in this browser: {plural(stats.highlights, 'highlight')} with {plural(stats.notes, 'note')}, on{' '}
            {plural(stats.pages, 'page')}.
          </p>
        )}
      </div>
    </section>
  );
}

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

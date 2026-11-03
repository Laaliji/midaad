import { useEffect, useState } from 'preact/hooks';

export function ShortcutsSection() {
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);

  useEffect(() => {
    void chrome.commands.getAll().then(setCommands);
  }, []);

  return (
    <section class="op-section" aria-labelledby="shortcuts-h">
      <header class="op-section__head">
        <div>
          <h1 id="shortcuts-h">Shortcuts</h1>
          <p class="op-lede">Keyboard shortcuts are managed by the browser, so they won’t clash with other extensions.</p>
        </div>
        <button
          type="button"
          class="op-btn"
          onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
        >
          Change shortcuts
        </button>
      </header>

      <div class="op-card">
        <ul class="op-list">
          {commands
            .filter((c) => c.description)
            .map((c) => (
              <li class="op-list__row" key={c.name}>
                <span>{c.description}</span>
                {c.shortcut ? <Keys combo={c.shortcut} /> : <span class="op-muted">Not set</span>}
              </li>
            ))}
          <li class="op-list__row">
            <span>Highlight without the keyboard</span>
            <span class="op-muted">Right-click → Highlight with Midaad</span>
          </li>
          <li class="op-list__row">
            <span>Close the highlight toolbar, a note, the settings panel or reader view</span>
            <Keys combo="Esc" />
          </li>
        </ul>
      </div>
      <p class="op-hint">
        If a shortcut shows as “Not set”, another extension already uses it;
        choose a different one with <strong>Change shortcuts</strong>.
      </p>
    </section>
  );
}

function Keys({ combo }: { combo: string }) {
  const parts = combo.split('+');
  return (
    <span class="op-keys" aria-label={combo}>
      {parts.map((k, i) => (
        <kbd class="op-kbd" key={i}>
          {k}
        </kbd>
      ))}
    </span>
  );
}

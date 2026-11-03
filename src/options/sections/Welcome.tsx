export function Welcome({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div class="op-welcome" role="region" aria-labelledby="welcome-h">
      <div>
        <h2 id="welcome-h" class="op-welcome__title">
          Welcome to Midaad <span lang="ar">· أهلًا</span>
        </h2>
        <ol class="op-steps">
          <li>
            <strong>Pin it.</strong> Click the puzzle-piece icon in the toolbar, then the pin next to Midaad.
          </li>
          <li>
            <strong>Open a document:</strong> right-click the Midaad icon → <em>Open a document</em> to read a PDF,
            EPUB or Word file. Or <a href="../library/index.html">open your Library</a>.
          </li>
          <li>
            <strong>Or open a web article</strong> and click the Midaad icon, or press <kbd class="op-kbd">Alt</kbd>+
            <kbd class="op-kbd">R</kbd>.
          </li>
          <li>
            <strong>Highlight</strong> by selecting text and choosing a colour. Click a highlight to add a note.
          </li>
          <li>
            <strong>Make it yours.</strong> Pick a theme and font below. Changes apply instantly.
          </li>
        </ol>
      </div>
      <button type="button" class="op-icon-btn" aria-label="Dismiss welcome" onClick={onDismiss}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  );
}

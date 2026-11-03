import logoUrl from '../../../assets/brand/midaad-logo-768.png';

export function AboutSection() {
  const version = chrome.runtime.getManifest().version;
  return (
    <section class="op-section" aria-labelledby="about-h">
      <header class="op-section__head">
        <div>
          <h1 id="about-h">About &amp; privacy</h1>
          <p class="op-lede">Midaad (مداد) means “ink”: what stays after the reading is done.</p>
        </div>
      </header>

      <div class="op-about">
        <img class="op-about__logo" src={logoUrl} alt="Midaad: Read, Highlight, Grow" width={768} height={512} />
        <div class="op-card">
          <h2 class="op-h2">Your reading stays yours</h2>
          <ul class="op-checks">
            <li>No accounts, no servers, no analytics. Midaad never sends data over the network.</li>
            <li>Settings live in this browser’s extension storage, not in Chrome Sync.</li>
            <li>Highlights and notes are kept in the extension’s own database (IndexedDB) on this device.</li>
            <li>
              Midaad only runs on a page after you click its button, press a shortcut or use its right-click menu (the{' '}
              <code>activeTab</code> permission), unless you turn on automatic restore under Highlights.
            </li>
            <li>Fonts are bundled with the extension, so no font services are contacted.</li>
          </ul>
          <p class="op-muted op-version">Version {version}</p>
        </div>
      </div>
    </section>
  );
}

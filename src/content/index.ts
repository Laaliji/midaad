/**
 * Content script entry. Injected on demand by the background (activeTab + scripting),
 * so it only runs on pages where you used Midaad.
 */
import { listen, type TabApi } from '../shared/messages';
import { ReaderController } from './reader/ReaderController';

interface MidaadInstance {
  destroy(): void;
}

declare global {
  interface Window {
    __midaad?: MidaadInstance;
  }
}

function init(): MidaadInstance {
  const reader = new ReaderController();

  const stopListening = listen<TabApi>({
    'content/ping': () => 'pong',
    'reader/toggle': async () => ({ open: await reader.toggle() }),
  });

  return {
    destroy() {
      stopListening();
      reader.destroy();
    },
  };
}

// The background only injects us when nothing answers its ping. If an older copy still exists
// (for example after the extension was reloaded), tear it down so its UI doesn't linger.
try {
  window.__midaad?.destroy();
} catch {
  /* the old copy's extension context may already be gone */
}
window.__midaad = init();

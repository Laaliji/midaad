/**
 * Content script entry. Injected on demand by the background (activeTab + scripting), so it only
 * runs on pages where you used Midaad, or on every page if you opted in to automatic restore.
 */
import { listen, type TabApi } from '../shared/messages';
import { DEFAULT_SETTINGS, getSettings, onSettingsChanged, type Settings } from '../shared/settings';
import { ReaderController } from './reader/ReaderController';
import { PageHighlights } from './highlights/page';
import { clearAll } from './highlights/painter';
import { HighlightStore } from './highlights/store';
import { showToast } from './ui/toast';

interface MidaadInstance {
  destroy(): void;
}

declare global {
  interface Window {
    __midaad?: MidaadInstance;
  }
}

function init(): MidaadInstance {
  let settings: Settings = DEFAULT_SETTINGS;
  const highlightSettings = () => settings.highlights;
  const store = new HighlightStore();
  const reader = new ReaderController(store, highlightSettings);
  const page = new PageHighlights(store, highlightSettings);

  clearAll(); // paint left behind by an older copy of this script
  const stopSettings = onSettingsChanged((s) => (settings = s));
  void getSettings()
    .then((s) => (settings = s))
    .finally(() => void page.start());

  const stopListening = listen<TabApi>({
    'content/ping': () => 'pong',
    'reader/toggle': async () => ({ open: await reader.toggle() }),
    'highlights/fromSelection': () => {
      const created = reader.isOpen ? reader.highlightSelection() : page.highlightSelection();
      if (!created) showToast('Select some text first, then highlight it.', reader.isOpen && reader.isDark ? 'dark' : 'light');
      return { created };
    },
  });

  return {
    destroy() {
      stopListening();
      stopSettings();
      reader.destroy();
      page.destroy();
      clearAll();
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

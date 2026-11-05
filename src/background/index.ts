/**
 * Background service worker: routes toolbar clicks, keyboard commands and the right-click menu
 * to the active tab, owns the highlights database, and handles requests from content scripts
 * and extension pages.
 */
import { listen, type BackgroundApi } from '../shared/messages';
import { openLibrary, toggleReader } from './reader';
import {
  createContextMenus,
  highlightHandlers,
  highlightSelectionInTab,
  onContextMenuClick,
  syncAutoRestore,
} from './highlights';

chrome.action.onClicked.addListener((tab) => void toggleReader(tab));

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab) return;
  if (command === 'toggle-reader') void toggleReader(tab);
  else if (command === 'highlight-selection') void highlightSelectionInTab(tab);
});

chrome.contextMenus.onClicked.addListener(onContextMenuClick);

listen<BackgroundApi>({
  'ui/openLibrary': () => openLibrary(),
  'ui/openOptions': async ({ section }) => {
    if (!section) return chrome.runtime.openOptionsPage();
    await chrome.tabs.create({ url: chrome.runtime.getURL(`options/index.html#${section}`) });
  },
  ...highlightHandlers,
});

const syncQuietly = () => void syncAutoRestore().catch((err) => console.warn('[Midaad] auto-restore sync failed', err));
chrome.permissions.onAdded.addListener(syncQuietly);
chrome.permissions.onRemoved.addListener(syncQuietly);
syncQuietly();

chrome.runtime.onInstalled.addListener(({ reason }) => {
  createContextMenus();
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html#welcome') });
  }
});

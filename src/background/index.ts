/**
 * Background service worker: routes toolbar clicks and keyboard commands to the active tab
 * and handles requests from content scripts and extension pages.
 */
import { listen, type BackgroundApi } from '../shared/messages';
import { toggleReader } from './reader';

chrome.action.onClicked.addListener((tab) => void toggleReader(tab));

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-reader' && tab) void toggleReader(tab);
});

listen<BackgroundApi>({
  'ui/openOptions': async ({ section }) => {
    if (!section) return chrome.runtime.openOptionsPage();
    await chrome.tabs.create({ url: chrome.runtime.getURL(`options/index.html#${section}`) });
  },
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html#welcome') });
  }
});

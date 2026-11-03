import { sendToTab } from '../shared/messages';

/**
 * Make sure our content script is running in the tab. With `activeTab`, a toolbar click
 * or keyboard shortcut grants temporary access to the current tab, and `scripting` injects into it.
 */
export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    if ((await sendToTab(tabId, 'content/ping')) === 'pong') return;
  } catch {
    // No listener yet: inject below.
  }
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content.js'] });
}

export async function toggleReader(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  try {
    await ensureContentScript(tab.id);
    await sendToTab(tab.id, 'reader/toggle');
  } catch (err) {
    console.info('[Midaad] cannot run on this page:', tab.url, err);
    await flagUnsupported(tab.id);
  }
}

/**
 * Browser pages (chrome://, the Web Store, the PDF viewer, and so on) don't allow extensions.
 * Show a brief badge instead of failing silently.
 */
async function flagUnsupported(tabId: number) {
  const title = 'Midaad can’t run on this page (browser pages and the Web Store are protected).';
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#7f4f24' }),
    chrome.action.setBadgeTextColor?.({ tabId, color: '#fffdf8' }),
    chrome.action.setBadgeText({ tabId, text: '!' }),
    chrome.action.setTitle({ tabId, title }),
  ]).catch(() => {});
  setTimeout(() => {
    void chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    const title = chrome.runtime.getManifest().action?.default_title ?? 'Midaad';
    void chrome.action.setTitle({ tabId, title }).catch(() => {});
  }, 4000);
}

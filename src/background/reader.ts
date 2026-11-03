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
  if (isPdfUrl(tab.url)) return openLibrary(tab, tab.url);
  try {
    await ensureContentScript(tab.id);
    await sendToTab(tab.id, 'reader/toggle');
  } catch (err) {
    // Browser pages (new tab, settings, the Web Store, the PDF viewer…) don't allow extensions.
    // Open the Library instead, so the click always leads somewhere useful.
    console.info('[Midaad] cannot run on this page, opening the Library:', tab.url, err);
    await openLibrary(tab);
  }
}

/** PDFs shown in the browser's own viewer: hand them to the Library, which converts them. */
export function isPdfUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (!['http:', 'https:', 'file:'].includes(u.protocol)) return false;
    return /[.]pdf$/i.test(u.pathname) || (u.hostname.endsWith('arxiv.org') && u.pathname.startsWith('/pdf/'));
  } catch {
    return false;
  }
}

export async function openLibrary(tab?: chrome.tabs.Tab, src?: string): Promise<void> {
  const url = chrome.runtime.getURL(`library/index.html${src ? `?src=${encodeURIComponent(src)}` : ''}`);
  // Replace an empty new tab rather than piling up tabs; otherwise open next to the current one.
  const blank = !tab?.url || /^(chrome|edge|brave):[/][/](newtab|new-tab-page)/.test(tab.url) || tab.url === 'about:blank';
  if (tab?.id !== undefined && blank) await chrome.tabs.update(tab.id, { url });
  else await chrome.tabs.create({ url, index: tab?.index !== undefined ? tab.index + 1 : undefined });
}

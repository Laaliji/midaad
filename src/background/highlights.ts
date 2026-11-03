/**
 * Highlight storage handlers, the right-click menu, and the opt-in auto-restore content script.
 */
import { db } from '../shared/db';
import { ensureContentScript, openLibrary } from './reader';
import { sendToTab, type BackgroundApi, type Handlers } from '../shared/messages';
import { isHighlightColor, LIMITS, type Highlight, type HighlightPatch, type PageMeta } from '../shared/highlights';

/* ------------------------------------------------------------------ storage */

function clampStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** Content scripts are ours, but validate anyway: the database outlives any one bug. */
function sanitizeHighlight(h: Highlight): Highlight {
  if (!h || typeof h.id !== 'string' || !/^[0-9a-f]{32}$/.test(h.id)) throw new Error('Invalid highlight id');
  if (!h.quote || typeof h.quote.exact !== 'string' || !h.quote.exact) throw new Error('Empty highlight');
  const now = Date.now();
  return {
    id: h.id,
    url: clampStr(h.url, 4096),
    quote: {
      exact: clampStr(h.quote.exact, LIMITS.text),
      prefix: clampStr(h.quote.prefix, LIMITS.context),
      suffix: clampStr(h.quote.suffix, LIMITS.context),
    },
    position: Math.min(1, Math.max(0, Number(h.position) || 0)),
    text: clampStr(h.text, LIMITS.text),
    color: isHighlightColor(h.color) ? h.color : 'honey',
    note: clampStr(h.note, LIMITS.note),
    createdAt: Number(h.createdAt) || now,
    updatedAt: now,
  };
}

async function upsertPage(meta: PageMeta) {
  const d = await db();
  const tx = d.transaction('pages', 'readwrite');
  const existing = await tx.store.get(meta.url);
  const now = Date.now();
  await tx.store.put({
    url: meta.url,
    title: clampStr(meta.title, 500) || existing?.title || meta.url,
    siteName: clampStr(meta.siteName, 200) || existing?.siteName || '',
    lang: meta.lang ?? existing?.lang,
    dir: meta.dir ?? existing?.dir,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  await tx.done;
}

async function update(id: string, patch: HighlightPatch): Promise<Highlight> {
  const d = await db();
  const tx = d.transaction('highlights', 'readwrite');
  const h = await tx.store.get(id);
  if (!h) throw new Error('Highlight not found');
  if (patch.color !== undefined && isHighlightColor(patch.color)) h.color = patch.color;
  if (patch.note !== undefined) h.note = clampStr(patch.note, LIMITS.note);
  h.updatedAt = Date.now();
  await tx.store.put(h);
  await tx.done;
  return h;
}

export const highlightHandlers: Handlers<BackgroundApi> = {
  'highlights/forPage': async ({ url }) => {
    const list = await (await db()).getAllFromIndex('highlights', 'url', url);
    return list.sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
  },

  'highlights/create': async ({ highlight, page }) => {
    const h = sanitizeHighlight(highlight);
    await (await db()).put('highlights', h);
    await upsertPage({ ...page, url: h.url });
    return h;
  },

  'highlights/update': ({ id, patch }) => update(id, patch),

  'highlights/delete': async ({ id }) => {
    await (await db()).delete('highlights', id);
  },

  'highlights/stats': async () => {
    const d = await db();
    const all = await d.getAll('highlights');
    return {
      highlights: all.length,
      notes: all.filter((h) => h.note.trim()).length,
      pages: new Set(all.map((h) => h.url)).size,
    };
  },
};

/* ------------------------------------------------------------------ highlight the selection */

/** Used by the Alt+H shortcut and the right-click menu. Both grant `activeTab` for this tab. */
export async function highlightSelectionInTab(tab: chrome.tabs.Tab | undefined, frameId = 0) {
  if (tab?.id === undefined || frameId !== 0) return; // only the top frame is supported for now
  try {
    await ensureContentScript(tab.id);
    await sendToTab(tab.id, 'highlights/fromSelection');
  } catch (err) {
    console.info('[Midaad] cannot highlight on this page:', err);
  }
}

const MENU_ID = 'midaad-highlight';
const LIBRARY_MENU_ID = 'midaad-library';

export function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Highlight with Midaad', contexts: ['selection'] });
    // Right-click on the toolbar icon.
    chrome.contextMenus.create({ id: LIBRARY_MENU_ID, title: 'Open a document (PDF, EPUB, Word…)', contexts: ['action'] });
  });
}

export function onContextMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  if (info.menuItemId === MENU_ID) void highlightSelectionInTab(tab, info.frameId ?? 0);
  else if (info.menuItemId === LIBRARY_MENU_ID) void openLibrary(tab);
}

/* ------------------------------------------------------------------ opt-in auto-restore */

export const ALL_URLS = { origins: ['<all_urls>'] };
const AUTO_SCRIPT_ID = 'midaad-auto';

/**
 * When the user grants the optional `<all_urls>` permission (from Options), register the content
 * script on every page so highlights reappear without a click. Revoking it unregisters the script.
 * Called on every service-worker start, so the two can never drift apart.
 */
export async function syncAutoRestore(): Promise<void> {
  const granted = await chrome.permissions.contains(ALL_URLS);
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT_ID] })).length > 0;
  if (granted && !registered) {
    await chrome.scripting.registerContentScripts([
      {
        id: AUTO_SCRIPT_ID,
        matches: ['<all_urls>'],
        js: ['content.js'],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
  } else if (!granted && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT_ID] });
  }
}

/**
 * Typed message passing between the background, content scripts and extension pages.
 *
 * - `BackgroundApi`: requests the service worker handles (sent from content scripts and pages).
 * - `TabApi`: requests a content script handles (sent from the background or side panel to a tab).
 *
 * Adding a message = adding one entry to a map; the compiler checks payloads and responses everywhere.
 */

import type { Highlight, HighlightPatch, PageMeta } from './highlights';

export type BackgroundApi = {
  'ui/openOptions': { req: { section?: string }; res: void };
  'ui/openLibrary': { req: void; res: void };
  'highlights/forPage': { req: { url: string }; res: Highlight[] };
  'highlights/create': { req: { highlight: Highlight; page: PageMeta }; res: Highlight };
  'highlights/update': { req: { id: string; patch: HighlightPatch }; res: Highlight };
  'highlights/delete': { req: { id: string }; res: void };
  'highlights/stats': { req: void; res: { highlights: number; notes: number; pages: number } };
};

export type TabApi = {
  'content/ping': { req: void; res: 'pong' };
  'reader/toggle': { req: void; res: { open: boolean } };
  /** Highlight the current selection (keyboard shortcut and right-click menu). */
  'highlights/fromSelection': { req: void; res: { created: boolean } };
};

type Api = Record<string, { req: unknown; res: unknown }>;
export type Req<A extends Api, K extends keyof A> = A[K]['req'];
export type Res<A extends Api, K extends keyof A> = A[K]['res'];

interface Envelope<K = string, P = unknown> {
  __midaad: true;
  type: K;
  payload: P;
}
type Reply<R> = { ok: true; data: R } | { ok: false; error: string };

export type Handlers<A extends Api> = {
  [K in keyof A]?: (payload: A[K]['req'], sender: chrome.runtime.MessageSender) => A[K]['res'] | Promise<A[K]['res']>;
};

function envelope<K extends string>(type: K, payload: unknown): Envelope<K> {
  return { __midaad: true, type, payload };
}

function unwrap<R>(reply: Reply<R> | undefined, type: string): R {
  if (!reply) throw new Error(`No handler responded to "${type}"`);
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

/** Send a request to the background service worker. */
export async function sendToBackground<K extends keyof BackgroundApi & string>(
  type: K,
  ...[payload]: Req<BackgroundApi, K> extends void ? [] : [Req<BackgroundApi, K>]
): Promise<Res<BackgroundApi, K>> {
  const reply = (await chrome.runtime.sendMessage(envelope(type, payload))) as Reply<Res<BackgroundApi, K>> | undefined;
  return unwrap(reply, type);
}

/** Send a request to the content script running in a tab (top frame only). */
export async function sendToTab<K extends keyof TabApi & string>(
  tabId: number,
  type: K,
  ...[payload]: Req<TabApi, K> extends void ? [] : [Req<TabApi, K>]
): Promise<Res<TabApi, K>> {
  const reply = (await chrome.tabs.sendMessage(tabId, envelope(type, payload), { frameId: 0 })) as
    | Reply<Res<TabApi, K>>
    | undefined;
  return unwrap(reply, type);
}

/**
 * Register handlers for one side of the API. Unknown messages are ignored (return false)
 * so several listeners can coexist; known ones always answer with a Reply envelope.
 */
export function listen<A extends Api>(handlers: Handlers<A>): () => void {
  const listener = (
    msg: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (reply: Reply<unknown>) => void,
  ): boolean => {
    if (!isEnvelope(msg)) return false;
    const handler = handlers[msg.type as keyof A];
    if (!handler) return false;
    Promise.resolve()
      .then(() => handler(msg.payload as never, sender))
      .then(
        (data) => sendResponse({ ok: true, data }),
        (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
    return true; // keep the channel open for the async response
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

function isEnvelope(msg: unknown): msg is Envelope {
  return typeof msg === 'object' && msg !== null && (msg as Envelope).__midaad === true;
}

/**
 * IndexedDB, owned by the extension's origin. The background and extension pages (Library,
 * later the side panel) open it directly. Content scripts can't (their IndexedDB belongs to the
 * web page), so they go through the background's message API.
 *
 * Versioning: bump DB_VERSION and add an `if (oldVersion < N)` step in `upgrade`. Never edit an earlier step.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Highlight, PageRecord } from './highlights';
import type { DocumentContent, DocumentRecord } from './documents';

export interface MidaadDB extends DBSchema {
  highlights: {
    key: string;
    value: Highlight;
    indexes: { url: string; updatedAt: number };
  };
  pages: {
    key: string;
    value: PageRecord;
    indexes: { updatedAt: number };
  };
  /** Files opened in the Library: metadata only, so listing them stays fast. */
  documents: {
    key: string;
    value: DocumentRecord;
    indexes: { openedAt: number };
  };
  /** The converted, sanitized HTML of each document, loaded only when it's opened. */
  documentContent: {
    key: string;
    value: DocumentContent;
  };
}

export const DB_NAME = 'midaad';
export const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<MidaadDB>> | null = null;

export function db(): Promise<IDBPDatabase<MidaadDB>> {
  dbPromise ??= openDB<MidaadDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      // Each step upgrades one version; a new install runs them all in order.
      if (oldVersion < 1) {
        const hl = database.createObjectStore('highlights', { keyPath: 'id' });
        hl.createIndex('url', 'url');
        hl.createIndex('updatedAt', 'updatedAt');
        const pages = database.createObjectStore('pages', { keyPath: 'url' });
        pages.createIndex('updatedAt', 'updatedAt');
      }
      if (oldVersion < 2) {
        const docs = database.createObjectStore('documents', { keyPath: 'key' });
        docs.createIndex('openedAt', 'openedAt');
        database.createObjectStore('documentContent', { keyPath: 'key' });
      }
    },
    blocking() {
      // Another context (e.g. a freshly updated background) needs a newer version: let it.
      void dbPromise?.then((d) => d.close());
      dbPromise = null;
    },
    terminated() {
      dbPromise = null; // the browser closed it; reopen on next use
    },
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

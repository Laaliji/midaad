/**
 * The Library: open PDF, EPUB, Word, text and HTML files in Midaad's reader, and come back to
 * them later. Runs as an extension page, so files never leave the browser.
 */
import { render } from 'preact';
import '../shared/ui/tokens.css';
import '../shared/ui/controls.css';
import '../options/options.css';
import './library.css';
import { loadFonts } from '../shared/fonts';
import { DEFAULT_SETTINGS, getSettings, onSettingsChanged, type Settings } from '../shared/settings';
import { isTextless, type DocumentRecord } from '../shared/documents';
import { ReaderController } from '../content/reader/ReaderController';
import { HighlightStore } from '../content/highlights/store';
import { convertFile, deleteDocument, listDocuments, loadDocument, saveDocument, saveProgress, DocumentError, type OpenedDocument } from '../documents';
import { App, errorStatus, type Status } from './App';

const media = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => (document.documentElement.dataset.theme = media.matches ? 'dark' : 'light');
applyTheme();
media.addEventListener('change', applyTheme);
void loadFonts(['literata'], document.fonts, 'url');

let settings: Settings = DEFAULT_SETTINGS;
void getSettings().then((s) => (settings = s));
onSettingsChanged((s) => (settings = s));

const store = new HighlightStore();
const reader = new ReaderController(store, () => settings.highlights);
const baseTitle = document.title;

let status: Status = { kind: 'idle' };
let docs: DocumentRecord[] | null = null;
let removed: { doc: DocumentRecord; timer: number } | null = null;
/** Kept in memory only while a password is being asked for. */
let pendingFile: { bytes: Uint8Array; name: string } | null = null;

function update(patch: { status?: Status } = {}) {
  if (patch.status) status = patch.status;
  render(
    <App
      status={status}
      docs={docs?.filter((d) => d.key !== removed?.doc.key) ?? null}
      removed={removed?.doc ?? null}
      onFile={(file) => void openFile(file)}
      onOpen={(d) => void openStored(d.key)}
      onRemove={remove}
      onUndoRemove={undoRemove}
      onPassword={(pw) => pendingFile && void openBytes(pendingFile.bytes, pendingFile.name, pw)}
      onDismiss={() => {
        pendingFile = null;
        update({ status: { kind: 'idle' } });
      }}
    />,
    document.getElementById('app')!,
  );
}

async function refreshList() {
  try {
    docs = await listDocuments();
  } catch (err) {
    console.error('[Midaad] could not list documents', err);
    docs = [];
  }
  update();
}

async function openFile(file: File) {
  update({ status: { kind: 'loading', name: file.name } });
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    update({ status: { kind: 'error', name: file.name, message: 'The browser couldn’t read this file.', hint: 'Check that it still exists and isn’t open in another program, then try again.' } });
    return;
  }
  await openBytes(bytes, file.name);
}

async function openBytes(bytes: Uint8Array, name: string, password?: string) {
  update({ status: { kind: 'loading', name } });
  try {
    const doc = await convertFile(bytes, name, {
      password,
      onProgress: (done, total) => update({ status: { kind: 'loading', name, detail: `Reading page ${done} of ${total}…` } }),
    });
    pendingFile = null;
    doc.record = await saveDocument(doc);
    await show(doc);
  } catch (err) {
    if (err instanceof DocumentError && (err.code === 'password' || err.code === 'wrong-password')) {
      pendingFile = { bytes, name };
      update({ status: { kind: 'password', name, wrong: err.code === 'wrong-password' } });
    } else {
      pendingFile = null;
      update({ status: errorStatus(name, err) });
    }
  }
}

async function openStored(key: string) {
  try {
    const doc = await loadDocument(key);
    if (!doc) {
      update({ status: { kind: 'error', name: 'this document', message: 'It’s no longer in your Library.', hint: 'Open the file again to read it.' } });
      return void refreshList();
    }
    await show(doc);
  } catch (err) {
    update({ status: errorStatus('this document', err) });
  }
}

const SCANNED_NOTICE = {
  some: 'Some pages of this PDF are scans. They’re shown as pictures, so their text can’t be highlighted.',
  all: 'This PDF is made of scanned pages, shown as pictures. To read and highlight a page’s text, open “Text recognized on this page” under its picture.',
  textless:
    'This PDF is made of scanned pages, shown as pictures. There’s no text to select, so highlights and notes are turned off for it. To read and highlight the text, run the file through OCR (for example OCRmyPDF, or “Make searchable” in Acrobat), then open the result.',
};

function scannedNotice(record: DocumentRecord): string | undefined {
  if (!record.scanned) return undefined;
  return isTextless(record) ? SCANNED_NOTICE.textless : SCANNED_NOTICE[record.scanned];
}

/** Figures are drawn from the original PDF; pdf.js loads only when a document has some. */
function figureMounter(file: Uint8Array | undefined) {
  if (!file) return undefined;
  return (body: HTMLElement) => {
    let unmount: (() => void) | null = null;
    let cancelled = false;
    void import('../documents/pdfFigures').then(({ mountPdfFigures }) => {
      if (!cancelled) unmount = mountPdfFigures(body, file);
    });
    return () => {
      cancelled = true;
      unmount?.();
    };
  };
}

async function show({ record, article, file }: OpenedDocument) {
  await store.load(record.key);
  update({ status: { kind: 'idle' } });
  history.replaceState(null, '', `#${encodeURIComponent(record.key)}`);
  document.title = `${record.title} · Midaad`;
  await reader.openArticle(article, {
    closeLabel: 'Back to Library',
    notice: scannedNotice(record),
    textless: isTextless(record),
    onBodyMount: figureMounter(file),
    initialProgress: record.progress,
    onProgress: (p) => void saveProgress(record.key, p),
    onClosed: () => {
      history.replaceState(null, '', location.pathname);
      document.title = baseTitle;
      void refreshList();
    },
  });
}

function remove(doc: DocumentRecord) {
  if (removed) {
    clearTimeout(removed.timer);
    void deleteDocument(removed.doc.key);
  }
  removed = {
    doc,
    timer: window.setTimeout(() => {
      void deleteDocument(doc.key).then(refreshList);
      removed = null;
    }, 6000),
  };
  update();
}

function undoRemove() {
  if (!removed) return;
  clearTimeout(removed.timer);
  removed = null;
  update();
}

// Leaving the page: finish a pending removal.
addEventListener('pagehide', () => {
  if (removed) void deleteDocument(removed.doc.key);
});

/** A PDF passed in from a browser tab (toolbar click on a PDF), or a document to reopen. */
async function start() {
  update();
  await refreshList();
  const params = new URLSearchParams(location.search);
  const src = params.get('src');
  const key = decodeURIComponent(location.hash.slice(1));
  if (src) {
    history.replaceState(null, '', location.pathname);
    await openUrl(src);
  } else if (key.startsWith('doc:')) {
    await openStored(key);
  }
}

async function openUrl(src: string) {
  const name = decodeURIComponent(src.split(/[?#]/)[0]!.split('/').pop() || 'document.pdf');
  update({ status: { kind: 'loading', name, detail: 'Downloading…' } });
  try {
    const res = await fetch(src, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await openBytes(new Uint8Array(await res.arrayBuffer()), name.includes('.') ? name : `${name}.pdf`);
  } catch {
    const local = src.startsWith('file:');
    update({
      status: errorStatus(
        name,
        new DocumentError(
          'network',
          local ? 'Midaad isn’t allowed to read files from your computer through the browser.' : 'Midaad couldn’t download this document.',
          local
            ? 'Drop the file here or use “Choose a file”. (Or, in your browser’s extension settings, turn on “Allow access to file URLs” for Midaad.)'
            : 'Save it to your computer, then drop it here or use “Choose a file”.',
        ),
      ),
    });
  }
}

void start();

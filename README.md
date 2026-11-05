# Midaad · مداد

**Read · Highlight · Grow.** A calm reading companion for Chromium browsers (Chrome, Edge, Brave).

Midaad (مداد, "ink") opens your **documents (PDF, EPUB, Word, text)** and web articles in a
clean, comfortable reader, and lets you highlight, annotate and revisit what mattered. Everything stays in your
browser: no accounts, no servers, no analytics.

| Feature | Status |
|---|---|
| **Library: open PDF, EPUB, Word (.docx), text and HTML files** in the reader; recent documents, reading position, contents | ✅ |
| Reader mode for web articles: themes, fonts (incl. dyslexia-friendly), size/spacing/width, reading time, progress | ✅ |
| Persistent highlights and notes, on the page and in reader view | ✅ |
| Side panel: this page / all highlights, search, export | ⏳ next |
| Reading progress memory and reading log | ⏳ |

---

## Requirements

- Node.js 22+ and npm 10+
- Chrome / Edge / Brave **116+**

## Setup and build

```bash
npm install
npm run build      # type-checks, then builds the extension into dist/
```

Other scripts:

| Script | What it does |
|---|---|
| `npm run dev` | Rebuilds `dist/` on every change (unminified, with sourcemaps) |
| `npm test` | Unit tests (Vitest + jsdom): text and RTL utilities, settings, article extraction and sanitizing, URL normalization, highlight anchoring |
| `npm run typecheck` | TypeScript, no emit |
| `npm run assets` | Regenerates the bundled fonts, pdf.js data (character maps, standard fonts) and toolbar icons |

## Load the unpacked extension

1. Run `npm run build`.
2. Open `chrome://extensions` (Edge: `edge://extensions`; Brave: `brave://extensions`).
3. Turn on **Developer mode** (top-right toggle; in Edge it's in the left sidebar).
4. Click **Load unpacked** and select the `dist/` folder.
5. Pin Midaad: click the puzzle-piece icon in the toolbar, then the pin next to Midaad.

**During development:** keep `npm run dev` running. After a rebuild, click the ↻ reload icon on
Midaad's card in `chrome://extensions`, then **refresh the tab** you're testing on. Pages that
were open before a reload still hold the old content script.

## Using it

### Open a document (PDF, EPUB, Word…)

1. **Right-click the Midaad icon → _Open a document_.** Clicking the icon on a new tab, or on a PDF
   open in the browser, opens it too. So does the *Library* link in Options.
2. **Drop a file** on the page, or click **Choose a file**.
3. It opens in the reader: pick a theme and font with **Aa**, jump between chapters with the
   **Contents** button (☰), select text to highlight, click a highlight to add a note.
4. **Esc** or *Back to Library* returns to your list. Documents are listed under **Recent**, with how
   far you've read, and reopen where you left off, with your highlights.

| Format | What you get |
|---|---|
| **EPUB** | Chapters in order, images, links between chapters, the book's language and direction. DRM-protected books can't be opened (Midaad says so). |
| **Word (.docx)** | Headings, paragraphs, lists, tables, footnotes, images. Word's own fonts and colours are replaced by the reader's. Old `.doc` files: save as .docx first. |
| **PDF** | The text is re-flowed into paragraphs and headings; running headers, footers and page numbers are removed; page starts are marked (*p. 12*). Arabic PDFs are put back into reading order. Scanned PDFs (images of pages) have no text: Midaad explains that OCR is needed. Password-protected PDFs ask for the password (it isn't saved). Complex layouts (multi-column papers, footnotes, formulas) may not re-flow perfectly. |
| **Text / Markdown / HTML** | Any encoding, including older Arabic (Windows-1256) files. |

Files are converted **in your browser**: nothing is uploaded. The converted text is kept in the
extension's database so documents reopen instantly. A document's highlights are tied to the file's
content (a SHA-256 fingerprint), so opening the same file again brings your notes back, even after
removing it from the Library.

### Web articles

- Click the Midaad toolbar icon or press **Alt+R** on an article to toggle reader view.
- **Aa** (top-right) opens reading settings: theme (Paper / Sepia / Ink), font, Arabic font,
  text size, line spacing and page width. Changes apply instantly and are remembered.
- **Esc** closes the settings panel, then the reader.
- All settings are also on the options page (right-click the icon → *Options*).

### Highlights and notes

- Once Midaad is active on a page (you clicked the icon or used a shortcut), **select text** and a
  small toolbar appears: pick one of four colours (Honey, Sage, Clay, Dusk), **✎** to highlight and
  write a note, or **Copy**. This works on the original page and in reader view.
- **Alt+H** highlights the selection in your default colour. So does right-click →
  **Highlight with Midaad**, which works even before Midaad is active on the page.
- **Click a highlight** to recolour it, add or edit its note, copy it, or remove it. Notes save as
  you type. Highlights with a note have a dotted underline.
- Highlights made in reader view appear on the original page, and the other way round.
- By default, saved highlights reappear on a page once Midaad is active there. To have them reappear
  on every visit automatically, turn on **Options → Highlights → Restore highlights automatically**.

Midaad can't run on browser pages (`chrome://…`), the Web Store, or the built-in PDF viewer.
The icon shows a brief **!** badge there.

## Permissions, and why

Midaad asks for as little as possible. No permission grants access to all your sites at install.

| Permission | Why it's needed |
|---|---|
| `activeTab` | When **you** click the icon or press the shortcut, Midaad gets temporary access to *that one tab*. Nothing runs on pages you haven't invoked it on. |
| `scripting` | Injects Midaad's content script into that tab (with the access `activeTab` just granted). |
| `storage` | Saves your reader settings in `chrome.storage.local`. Midaad deliberately avoids `storage.sync`, so nothing goes to your Google account. |
| `contextMenus` | Adds **Highlight with Midaad** to the right-click menu when text is selected, and **Open a document** to the icon's right-click menu. Choosing it grants `activeTab` for that tab, just like clicking the icon. No install warning. |
| `unlimitedStorage` | Books with images can be larger than the browser's default storage quota. No install warning. |
| *optional* `<all_urls>` host access | **Off by default, opt-in from Options → Highlights.** Only requested if you turn on *Restore highlights automatically*: Midaad then registers its content script on every page, so saved highlights reappear without a click. Turning the switch off (or revoking access in the browser) removes it. |
| `web_accessible_resources: fonts/*` | Not a permission prompt. It lets the reader load its bundled fonts on any page. |

Coming with later features:

| Permission | Why |
|---|---|
| `sidePanel` | The highlights side panel (feature 3). |

Highlights and notes are stored in IndexedDB inside the extension (not the web page's storage).
Uninstalling Midaad deletes them; export arrives with the side panel.

## Project structure

```
manifest.config.ts       Typed manifest → dist/manifest.json
vite.config.ts           Build 1: extension pages + background (ES modules)
vite.content.config.ts   Build 2: content script (single IIFE, as MV3 requires)
scripts/                 build, dev (watch), copy-fonts, build-icons
assets/brand/            Logo and icon sources (SVG)
public/                  Icons; fonts are copied here at build time (git-ignored)
src/
  background/            Service worker: toolbar/shortcut → inject + toggle; message router
    db.ts                IndexedDB schema (highlights, pages), versioned upgrades
    highlights.ts        Highlight storage handlers, right-click menu, opt-in auto-restore
  content/
    reader/              Readability extraction, sanitizing, reader UI (Preact) + controller
    highlights/          Anchoring, painting (CSS Highlight API), selection toolbar + popover,
                         page/reader surfaces, selection-action registry
    ui/                  Shadow-DOM host helper, toast
  options/               Options page (Preact): Reading, Highlights, Shortcuts, About
  library/               Library page: open files, recent documents, reader for documents
  documents/             File → HTML converters: detect (by content), EPUB (fflate), Word
                         (mammoth), PDF (pdf.js + pdfLayout re-flow), text/HTML; storage
  shared/
    messages.ts          Typed message maps (BackgroundApi, TabApi) + send/listen helpers
    settings.ts          Settings schema, defaults, storage, change subscription
    highlights.ts        Highlight data model and colour palette
    url.ts               URL normalization (highlights are keyed by page URL)
    db.ts                IndexedDB schema: highlights, pages, documents, documentContent
    documents.ts         Document records
    fonts.ts             Font catalog + loader (CSP-proof: fonts are passed as bytes)
    text.ts, i18n.ts     Word counting, reading speed per language, RTL detection, Arabic plurals
    ui/                  Design tokens, shared controls, article typography, brand mark
tests/                   Vitest unit tests
```

### Design notes

- **The page is never rewritten.** Readability runs on a *clone* of the document. The reader
  is a full-screen overlay inside a closed Shadow DOM, attached to `<html>`. While the overlay is
  open, the page's scrollbar is hidden and `<body>` is made `inert`. Both are restored exactly on close.
- **Isolation.** The host element resets inherited styles (`all: initial`, plus an explicit
  `direction`, which `all` doesn't reset). Styles go in as constructable stylesheets, which a
  page's CSP can't block. Key, wheel and pointer events are stopped at the host, so site shortcuts
  and scroll-jacking scripts can't interfere.
- **Safety.** Readability's output is sanitized with DOMPurify, which removes inline handlers
  such as `onerror`, scripts and forms before anything is inserted.
- **RTL and Arabic.** Direction comes from the text itself when the page's `lang`/`dir` is wrong.
  Article styles use logical CSS properties throughout. Arabic text gets a Naskh font, a slightly
  larger size and more leading, and never italics or letter-spacing. Reading time uses
  per-language reading speeds (Arabic ≈138 wpm, English ≈228 wpm; Trauzettel-Klosinski & Dietz, 2012).
- **Fonts.** Literata, Source Sans 3, Atkinson Hyperlegible, OpenDyslexic, Noto Naskh Arabic and
  Amiri, all under the SIL Open Font License, are bundled from `@fontsource`. No font CDN is contacted.
- **Palette.** Earthy walnut, olive and sage. Text/background pairs meet WCAG AA, and the light
  tones (Camel, Khaki, Sage) are used only for decoration. See `src/shared/ui/tokens.css`.

- **Highlights never touch the page's DOM.** They're painted with the CSS Custom Highlight API
  (`CSS.highlights` + `::highlight()`), so there are no `<mark>` wrappers to break React/Vue pages
  or to be wiped out by their re-renders. When a page re-renders, Midaad re-anchors.
- **Anchoring.** Each highlight is stored as a text quote (the passage plus 32 characters of context
  on each side, whitespace removed) and its approximate position. That's why a highlight made in
  reader view finds the same words on the original page, whose markup and spacing are different.
  Repeated phrases are told apart by their context. URLs are normalized (hash and tracking
  parameters removed) so a highlight survives `?utm_…` links.
- **Storage** is owned by the service worker. Content scripts can't open the extension's
  IndexedDB, so they use typed messages. Writes are optimistic and roll back with a message on failure.

- **Documents are untrusted input.** Every converter's output goes through the same DOMPurify
  sanitizer as web articles, and again when a stored document is reopened. pdf.js runs in a worker,
  never runs a PDF's scripts, and is kept on a patched version (≥ 6.2.108, see GHSA-hq66-cqwq-w95j).
- **PDF re-flow** (`documents/pdfLayout.ts`, unit-tested): runs → lines (by baseline) → paragraphs
  (line gaps, indents, short last lines, sentence ends) → headings (font size vs. body size).
  Lines repeated at the top/bottom of many pages are dropped. Right-to-left lines are re-ordered by
  position, with diacritics re-attached to their letters and Arabic presentation forms normalized.

### Built to extend

- **Messaging:** add a line to `BackgroundApi`/`TabApi` in `shared/messages.ts`, and the
  compiler checks both ends.
- **Selection actions** are a registry (`content/highlights/actions.ts`), so "Explain with AI" or
  "Read aloud" is one more entry. Chrome's built-in on-device AI APIs would keep the no-network promise.
- **Text-to-speech word tracking** can reuse `shared/text.ts` segmentation and the reader's DOM.
- **Flashcards** will be one more versioned IndexedDB store keyed by highlight id.

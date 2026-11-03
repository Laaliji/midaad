# Midaad · مداد

**Read · Highlight · Grow.** A calm reading companion for Chromium browsers (Chrome, Edge, Brave).

Midaad (مداد, "ink") turns cluttered articles into a clean, comfortable reading view, and
(coming next) lets you highlight, annotate and revisit what mattered. Everything stays in your
browser: no accounts, no servers, no analytics.

| Feature | Status |
|---|---|
| Reader mode: themes, fonts (incl. dyslexia-friendly), size/spacing/width, reading time, progress | ✅ |
| Persistent highlights and notes | ⏳ next |
| Side panel: this page / all highlights, search, export | ⏳ |
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
| `npm test` | Unit tests (Vitest + jsdom): text and RTL utilities, settings, article extraction and sanitizing |
| `npm run typecheck` | TypeScript, no emit |
| `npm run assets` | Regenerates the bundled fonts and toolbar icons (`assets/brand/icon*.svg` → `public/icons`) |

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

- Click the Midaad toolbar icon or press **Alt+R** on an article to toggle reader view.
- **Aa** (top-right) opens reading settings: theme (Paper / Sepia / Ink), font, Arabic font,
  text size, line spacing and page width. Changes apply instantly and are remembered.
- **Esc** closes the settings panel, then the reader.
- All settings are also on the options page (right-click the icon → *Options*).

Midaad can't run on browser pages (`chrome://…`), the Web Store, or the built-in PDF viewer.
The icon shows a brief **!** badge there.

## Permissions, and why

Midaad asks for as little as possible. No permission grants access to all your sites at install.

| Permission | Why it's needed |
|---|---|
| `activeTab` | When **you** click the icon or press the shortcut, Midaad gets temporary access to *that one tab*. Nothing runs on pages you haven't invoked it on. |
| `scripting` | Injects Midaad's content script into that tab (with the access `activeTab` just granted). |
| `storage` | Saves your reader settings in `chrome.storage.local`. Midaad deliberately avoids `storage.sync`, so nothing goes to your Google account. |
| `web_accessible_resources: fonts/*` | Not a permission prompt. It lets the reader load its bundled fonts on any page. |

Coming with later features:

| Permission | Why |
|---|---|
| `sidePanel` | The highlights side panel (feature 3). |
| *optional* `<all_urls>` host access | **Off by default, opt-in from Options.** Only needed if you want highlights to reappear and "resume reading" to work automatically on every visit, without clicking the icon first. You can revoke it at any time. |

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
  content/
    reader/              Readability extraction, sanitizing, reader UI (Preact) + controller
    ui/                  Shadow-DOM host helper, toast
  options/               Options page (Preact): Reading, Shortcuts, About
  shared/
    messages.ts          Typed message maps (BackgroundApi, TabApi) + send/listen helpers
    settings.ts          Settings schema, defaults, storage, change subscription
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

### Built to extend

- **Messaging:** add a line to `BackgroundApi`/`TabApi` in `shared/messages.ts`, and the
  compiler checks both ends.
- **Selection actions** (feature 2) will be a registry, so "Explain with AI" or "Read aloud" is
  one more entry. Chrome's built-in on-device AI APIs would keep the no-network promise.
- **Text-to-speech word tracking** can reuse `shared/text.ts` segmentation and the reader's DOM.
- **Flashcards** will be one more versioned IndexedDB store keyed by highlight id.

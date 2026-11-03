import pkg from './package.json' with { type: 'json' };

/**
 * Typed source of truth for manifest.json (emitted at build time).
 * Every permission is explained in the README; keep both in sync.
 */
export const manifest = {
  manifest_version: 3,
  name: 'Midaad — Read, Highlight, Grow',
  short_name: 'Midaad',
  description:
    'A calm reading companion: distraction-free reader, highlights and notes. Everything stays in your browser.',
  version: pkg.version,
  minimum_chrome_version: '116',
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_title: 'Midaad: open reader view (Alt+R)',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
    },
  },
  background: {
    service_worker: 'background.js',
    type: 'module',
  },
  options_page: 'options/index.html',
  permissions: ['activeTab', 'scripting', 'storage'],
  commands: {
    'toggle-reader': {
      suggested_key: { default: 'Alt+R' },
      description: 'Toggle reader view',
    },
  },
  web_accessible_resources: [
    {
      // Fonts are fetched by the content script so the reader can use them on any page.
      resources: ['fonts/*.woff2'],
      matches: ['<all_urls>'],
    },
  ],
} satisfies chrome.runtime.ManifestV3;

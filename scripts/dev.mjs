// Dev mode: rebuilds both bundles on change (unminified, inline sourcemaps).
// After a rebuild, click the reload icon on chrome://extensions and refresh the tab.
import { build } from 'vite';
import { rmSync } from 'node:fs';

process.env.MIDAAD_DEV = '1';
rmSync('dist', { recursive: true, force: true });
const watch = { buildDelay: 150 };
await Promise.all([
  build({ configFile: 'vite.config.ts', build: { watch }, logLevel: 'info' }),
  build({ configFile: 'vite.content.config.ts', build: { watch }, logLevel: 'info' }),
]);
console.log('\n👀 Watching for changes. Output: dist/');

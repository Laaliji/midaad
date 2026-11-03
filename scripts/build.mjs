// Production build: clean dist/, then build pages+background and the content script.
import { build } from 'vite';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
await build({ configFile: 'vite.config.ts', logLevel: 'warn' });
await build({ configFile: 'vite.content.config.ts', logLevel: 'warn' });
console.log('✓ Midaad built to dist/. Load it via chrome://extensions → "Load unpacked".');

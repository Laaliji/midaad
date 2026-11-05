import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest } from './manifest.config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Emits manifest.json from the typed manifest.config.ts. */
function manifestPlugin(): Plugin {
  return {
    name: 'midaad:manifest',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) });
    },
  };
}

/**
 * Build #1: extension pages (options, library, later side panel) + background service worker (ES module).
 * The content script is built separately (vite.content.config.ts) because it must be a classic IIFE.
 */
export default defineConfig({
  root: resolve(__dirname, 'src'),
  publicDir: resolve(__dirname, 'public'),
  plugins: [preact(), manifestPlugin()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false, // cleaned by scripts/build.mjs so both builds can share dist/
    target: 'chrome116',
    sourcemap: process.env.MIDAAD_DEV ? 'inline' : false,
    minify: !process.env.MIDAAD_DEV,
    modulePreload: false,
    rollupOptions: {
      input: {
        options: resolve(__dirname, 'src/options/index.html'),
        library: resolve(__dirname, 'src/library/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});

import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Build #2: the content script, as a single self-contained IIFE.
 * MV3 content scripts injected with chrome.scripting cannot be ES modules,
 * so everything (Readability, DOMPurify, Preact, CSS strings) is inlined here.
 */
export default defineConfig({
  plugins: [preact()],
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.MIDAAD_DEV ? 'development' : 'production') },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    target: 'chrome116',
    sourcemap: process.env.MIDAAD_DEV ? 'inline' : false,
    minify: !process.env.MIDAAD_DEV,
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'MidaadContent',
      fileName: () => 'content.js',
    },
  },
});

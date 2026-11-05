// Copies pdf.js character maps and standard font data into public/pdfjs, so PDFs that use
// CJK/Arabic CID fonts or the 14 standard fonts extract text correctly, fully offline.
import { cpSync, mkdirSync } from 'node:fs';

for (const dir of ['cmaps', 'standard_fonts']) {
  mkdirSync(`public/pdfjs/${dir}`, { recursive: true });
  cpSync(`node_modules/pdfjs-dist/${dir}`, `public/pdfjs/${dir}`, { recursive: true });
}
console.log('copied pdf.js cmaps and standard fonts');

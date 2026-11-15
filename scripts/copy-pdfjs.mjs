// Copies pdf.js character maps, standard font data, colour profiles and image decoders into
// public/pdfjs, so PDFs that use CJK/Arabic CID fonts, the 14 standard fonts, or JBIG2 / JPEG 2000
// pictures work fully offline.
// Also writes a patched copy of the pdf.js worker (see patchWorker below).
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { repairUnicode } from './glyph-repair.mjs';

for (const dir of ['cmaps', 'standard_fonts', 'iccs']) {
  mkdirSync(`public/pdfjs/${dir}`, { recursive: true });
  cpSync(`node_modules/pdfjs-dist/${dir}`, `public/pdfjs/${dir}`, { recursive: true });
}
// Image decoders for scans and pictures (JBIG2, JPEG 2000, colour profiles). Not quickjs: Midaad
// never runs a PDF's own scripts.
mkdirSync('public/pdfjs/wasm', { recursive: true });
for (const f of ['jbig2.wasm', 'jbig2_nowasm_fallback.js', 'openjpeg.wasm', 'openjpeg_nowasm_fallback.js', 'qcms_bg.wasm']) {
  cpSync(`node_modules/pdfjs-dist/wasm/${f}`, `public/pdfjs/wasm/${f}`);
}

/**
 * Right-to-left text: pdf.js collects one string per glyph, joins them, then reorders the line
 * from visual to logical order by reversing right-to-left runs. A glyph that stands for several
 * letters (lam-alef ﻻ, the ligature ﷲ, ﷺ, or lam-meem in many Arabic fonts) gets its letters
 * reversed too, so "الله" comes out as "هللا" and "الأول" as "األول".
 *
 * The fix: before the join, expand presentation forms and ligatures of each glyph (NFKC) and
 * pre-reverse any multi-letter right-to-left glyph, so the bidi step puts its letters back in
 * order. Phrase signs (ﷺ ﷻ ﷼ ﷽, U+FDFA–FDFD) stay single characters. pdf.ts turns off pdf.js's
 * own normalization, which would otherwise expand them after the join.
 */
const GLYPH_FIX =
  '(s=>{' +
  'let n="";for(const c of s){const k=c.charCodeAt(0);n+=((k>=64256&&k<=65023)||(k>=65136&&k<=65279))&&!(k>=65018&&k<=65021)?c.normalize("NFKC"):c}' +
  'if(n.length<2)return n;' +
  'for(const c of n){const k=c.charCodeAt(0);if((k>=1424&&k<=2303)||(k>=64285&&k<=65023)||(k>=65136&&k<=65276))return[...n].reverse().join("")}' +
  'return n})';

/**
 * Fonts whose ToUnicode table gives a few Arabic glyphs the wrong text (a damma as "ح", a shadda
 * as a space): see scripts/glyph-repair.mjs. Its function is inlined where pdf.js creates a glyph
 * from a character code (once per code and font), so the text layer reads the repaired text.
 */
const NEW_GLYPH = /([\w$]+)=new ([\w$]+)\(this\.fontExtraProperties,([\w$]+),([\w$]+),([\w$]+),/g;

function patchWorker(src) {
  const target = 'function runBidiTransform(e){let t=e.str.join("");';
  const count = src.split(target).length - 1;
  if (count !== 1) {
    throw new Error(`pdf.js worker patch: expected the bidi join exactly once, found ${count}. pdf.js changed: update scripts/copy-pdfjs.mjs.`);
  }
  let out = src.replace(target, `function runBidiTransform(e){let t=e.str.map(${GLYPH_FIX}).join("");`);

  const found = out.match(NEW_GLYPH) ?? [];
  if (found.length !== 1) {
    throw new Error(`pdf.js worker patch: expected one glyph constructor in charToGlyph, found ${found.length}. pdf.js changed: update scripts/copy-pdfjs.mjs.`);
  }
  const repair = repairUnicode.toString();
  out = out.replace(NEW_GLYPH, (_m, glyph, cls, code, fontChar, text) => `${glyph}=new ${cls}(this.fontExtraProperties,${code},${fontChar},(${repair})(this,${code},${text}),`);
  return out;
}

const worker = readFileSync('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'utf8');
writeFileSync('public/pdfjs/pdf.worker.min.mjs', patchWorker(worker));
console.log('copied pdf.js cmaps, fonts, colour profiles and decoders, patched the worker');

/**
 * Repairs Arabic fonts whose ToUnicode table lies about a few glyphs.
 *
 * Some PDF producers (seen with Word exports of Arabic fonts) write a ToUnicode table where a
 * handful of entries are wrong: the damma glyph says "ح", shadda and fathatan say " ", and in
 * ligatures like تح the second letter says "ُ". The page looks right, but the text comes out as
 * "الك حتاب" for "الكُتاب", "تُقيق" for "تحقيق", with words cut by false spaces.
 *
 * These fonts store their glyphs in Unicode order (the eight harakat side by side, ligatures
 * grouped by first letter), so a glyph's neighbours say what it should be: if the codes on
 * either side read "َ" and "ِ", the one between them is "ُ". A glyph is corrected only when
 *  - at least two neighbours agree on the same expected character,
 *  - that character is a different kind (letter, diacritic, space) from what the table says,
 *  - and no other glyph in the font already stands for it (so correct fonts never change).
 * The ligature ﷲ written as "الل" (its ه lost) becomes "الله".
 *
 * Runs inside the pdf.js worker: scripts/copy-pdfjs.mjs inlines `repairUnicode` as source text,
 * so it must stay self-contained (no imports, no outside names) and avoid string escapes.
 */
export function repairUnicode(font, code, text) {
  const tu = font && font.toUnicode;
  if (typeof text !== 'string' || !text.length || text.length > 3) return text;
  if (!tu || typeof tu.get !== 'function' || typeof tu.charCodeOf !== 'function' || tu.get(code) !== text) return text;

  const kind = (s) => {
    if (s.trim() === '') return 'space';
    const c = s.charCodeAt(s.length - 1);
    if ((c >= 0x64b && c <= 0x65f) || c === 0x670) return 'mark';
    if ((c >= 0x621 && c <= 0x64a) || (c >= 0x671 && c <= 0x6d3)) return 'letter';
    return 'other';
  };
  if (text === String.fromCharCode(0x627, 0x644, 0x644)) return String.fromCharCode(0x627, 0x644, 0x644, 0x647);
  const kt = kind(text);
  if (kt === 'other') return text;

  // What the neighbour `n` codes away says this glyph is.
  const pred = (n) => {
    const t = tu.get(code + n);
    if (typeof t !== 'string' || t.length !== text.length) return null;
    let last = t.charCodeAt(t.length - 1) - n;
    // Fonts skip the rarely used U+063B–063F: the glyph after غ is the tatweel.
    if (last >= 0x63b && last <= 0x63f) last = 0x640;
    return last > 32 ? t.slice(0, -1) + String.fromCharCode(last) : null;
  };
  const a = pred(-1);
  const b = pred(1);
  let e = null;
  if (a !== null && a === b) e = a;
  else if (a !== null && a === pred(-2)) e = a;
  else if (b !== null && b === pred(2)) e = b;
  if (e === null || e === text || e.slice(0, -1) !== text.slice(0, -1)) return text;
  const ke = kind(e);
  if ((ke !== 'letter' && ke !== 'mark') || ke === kt) return text;
  if (tu.charCodeOf(e) !== -1) return text;
  return e;
}

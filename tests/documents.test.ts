import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { decodeText, detectKind, DocumentError } from '../src/documents/detect';
import { join, parseEpub } from '../src/documents/epub';
import { fixArabicYeh, layoutPages, type TextRun } from '../src/documents/pdfLayout';
import { parseText } from '../src/documents/text';

/* ------------------------------------------------------------------ helpers */

function epub(chapters: Record<string, string>, opts: { encryption?: string; dir?: string } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:creator>A. Writer</dc:creator><dc:language>en</dc:language></metadata>
  <manifest>${Object.keys(chapters).map((f, i) => `<item id="c${i}" href="text/${f}" media-type="application/xhtml+xml"/>`).join('')}
    <item id="img" href="images/dot.png" media-type="image/png"/></manifest>
  <spine${opts.dir ? ` page-progression-direction="${opts.dir}"` : ''}>${Object.keys(chapters).map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine>
</package>`),
    'OEBPS/images/dot.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  };
  for (const [name, body] of Object.entries(chapters)) {
    files[`OEBPS/text/${name}`] = strToU8(
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{color:red}</style></head><body>${body}</body></html>`,
    );
  }
  if (opts.encryption) files['META-INF/encryption.xml'] = strToU8(opts.encryption);
  return zipSync(files);
}

const run = (str: string, x: number, y: number, size = 10, eol = true): TextRun => ({ str, x, y, width: str.length * size * 0.5, size, eol });

/* ------------------------------------------------------------------ detect */

describe('detectKind', () => {
  it('recognizes formats by content, not by extension', () => {
    expect(detectKind(strToU8('%PDF-1.7 ...'), 'whatever.bin')).toBe('pdf');
    expect(detectKind(epub({ 'a.xhtml': '<p>x</p>' }), 'book.zip')).toBe('epub');
    expect(detectKind(zipSync({ 'word/document.xml': strToU8('<x/>') }), 'file')).toBe('docx');
    expect(detectKind(strToU8('Just some notes.'), 'notes')).toBe('txt');
    expect(detectKind(strToU8('<!doctype html><html><body>x</body></html>'), 'page')).toBe('html');
  });

  it('explains what it cannot open', () => {
    const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(() => detectKind(doc, 'old.doc')).toThrow(/Old Word files/);
    expect(() => detectKind(zipSync({ 'xl/workbook.xml': strToU8('<x/>') }), 'a.xlsx')).toThrow(/Excel/);
    expect(() => detectKind(new Uint8Array(0), 'empty.txt')).toThrow(DocumentError);
    expect(() => detectKind(new Uint8Array([1, 0, 2, 0]), 'photo.jpg')).toThrow(/Images/);
  });
});

describe('decodeText', () => {
  it('handles UTF-8, BOMs and legacy Arabic (Windows-1256) text', () => {
    expect(decodeText(strToU8('café'))).toBe('café');
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]))).toBe('AB');
    // "مرحبا" in Windows-1256
    expect(decodeText(new Uint8Array([0xe3, 0xd1, 0xcd, 0xc8, 0xc7]))).toBe('مرحبا');
  });
});

/* ------------------------------------------------------------------ text */

describe('parseText', () => {
  it('joins wrapped lines into paragraphs and picks a title', () => {
    const p = parseText(strToU8('My Notes\n\nFirst line of a paragraph\nthat continues here.\n\n# Section\n- item one\n- item two\n'));
    expect(p.title).toBe('My Notes');
    expect(p.html).toContain('<p>First line of a paragraph that continues here.</p>');
    expect(p.html).toContain('<h2>Section</h2>');
    expect(p.html).toContain('<p>- item one</p>');
  });

  it('escapes HTML in text files', () => {
    expect(parseText(strToU8('a <script>x</script> b')).html).not.toContain('<script>');
  });
});

/* ------------------------------------------------------------------ epub */

describe('parseEpub', () => {
  it('reads metadata and chapters in spine order, inlining images and fixing links', () => {
    const book = epub({
      'one.xhtml': '<h1 id="top">Chapter One</h1><p>Hello <a href="two.xhtml#end">jump</a>.</p><img src="../images/dot.png"/>',
      'two.xhtml': '<h1>Chapter Two</h1><p id="end">The end.</p>',
    });
    const p = parseEpub(book);
    expect(p.title).toBe('Test Book');
    expect(p.author).toBe('A. Writer');
    expect(p.lang).toBe('en');
    expect(p.html.indexOf('Chapter One')).toBeLessThan(p.html.indexOf('Chapter Two'));
    expect(p.html).toContain('href="#c1-end"');
    expect(p.html).toContain('id="c1-end"');
    expect(p.html).toContain('src="data:image/png;base64,');
    expect(p.html).not.toContain('<style');
  });

  it('refuses DRM-protected books but accepts obfuscated fonts', () => {
    const drm = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
      <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/text/one.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`;
    expect(() => parseEpub(epub({ 'one.xhtml': '<p>x</p>' }, { encryption: drm }))).toThrow(/DRM/);

    const fonts = drm.replace('http://www.w3.org/2001/04/xmlenc#aes128-cbc', 'http://www.idpf.org/2008/embedding').replace('text/one.xhtml', 'fonts/a.otf');
    expect(parseEpub(epub({ 'one.xhtml': '<p>ok</p>' }, { encryption: fonts })).html).toContain('ok');
  });

  it('keeps the declared reading direction', () => {
    expect(parseEpub(epub({ 'a.xhtml': '<p>نص</p>' }, { dir: 'rtl' })).dir).toBe('rtl');
  });

  it('resolves relative paths', () => {
    expect(join('OEBPS/text/', '../images/a%20b.png#x')).toBe('OEBPS/images/a b.png');
  });
});

/* ------------------------------------------------------------------ pdf layout */

describe('layoutPages (PDF text → paragraphs)', () => {
  it('joins lines into paragraphs, detects headings and splits on paragraph gaps', () => {
    const { html } = layoutPages([
      {
        runs: [
          run('Introduction', 72, 700, 18),
          run('Reading slowly is a skill that can be', 72, 670),
          run('learned with practice and patience.', 72, 658),
          run('A second paragraph starts after a gap.', 72, 630),
        ],
      },
    ]);
    expect(html).toContain('<h2>Introduction</h2>');
    expect(html).toContain('<p>Reading slowly is a skill that can be learned with practice and patience.</p>');
    expect(html).toContain('<p>A second paragraph starts after a gap.</p>');
  });

  it('re-joins words hyphenated at the end of a line', () => {
    const { html } = layoutPages([{ runs: [run('This is a long infor-', 72, 700), run('mation dense sentence.', 72, 688)] }]);
    expect(html).toContain('information dense sentence.');
  });

  it('drops running headers and page numbers, and continues paragraphs across pages', () => {
    const pages = [1, 2, 3, 4, 5].map((n) => ({
      runs: [
        run('Journal of Calm Reading', 72, 780, 9),
        run(n === 1 ? 'The text begins here and the sentence' : `page ${n} body text that ends here.`, 72, 700),
        run(n === 1 ? 'goes on,' : 'Another line.', 72, 688),
        run(String(n), 300, 40, 9),
      ],
    }));
    const { html } = layoutPages(pages);
    expect(html).not.toContain('Journal of Calm Reading');
    expect(html).not.toMatch(/<p>[0-9]<[/]p>/);
    // page 1's paragraph didn't end, so page 2's first line continues it, with a page marker
    expect(html).toContain('goes on, <span data-page="2"></span>page 2 body text');
  });

  it('puts Arabic stored in visual order back into reading order, with ordinary letters', () => {
    // As pdf.js reports Edge-printed Arabic: pieces from left to right, presentation forms.
    const fa = String.fromCharCode(0xfed3); // ﻓ
    const lam = String.fromCharCode(0xfedf); // ﻟ
    const qaf = String.fromCharCode(0xfed8); // ﻘ
    const { html } = layoutPages([
      {
        runs: [
          { str: 'راءة', x: 468, y: 694, width: 32, size: 16, eol: false },
          { str: qaf, x: 500, y: 694, width: 7, size: 16, eol: false },
          { str: lam, x: 508, y: 694, width: 5, size: 16, eol: false },
          { str: 'ن ا', x: 513, y: 694, width: 23, size: 16, eol: false },
          { str: fa, x: 536, y: 694, width: 7, size: 16, eol: true },
        ],
      },
    ]);
    expect(html).toContain('فن القراءة');
  });

  it('puts diacritics drawn as separate pieces back on their letter', () => {
    const kasratan = String.fromCharCode(0x064d);
    const { html } = layoutPages([
      {
        runs: [
          { str: 'ت', x: 100, y: 700, width: 10, size: 10, eol: false },
          { str: kasratan, x: 101, y: 702, width: 6, size: 10, eol: false },
          { str: 'كلما', x: 110, y: 700, width: 40, size: 10, eol: true },
        ],
      },
    ]);
    expect(html).toContain('كلمات' + kasratan);
  });

  it('restores Arabic yeh where the font produced Persian yeh, but leaves Persian text alone', () => {
    const fy = String.fromCharCode(0x06cc);
    expect(fixArabicYeh([`ل${fy}ست`, `عل${fy}`])).toEqual(['ليست', 'على']);
    const persian = `پ چ گ ک ${fy}`;
    expect(fixArabicYeh([persian])).toEqual([persian]);
  });

  it('keeps Latin words and numbers inside an Arabic line in their own order', () => {
    const { html } = layoutPages([
      {
        runs: [
          { str: 'اليوم', x: 0, y: 700, width: 40, size: 10, eol: false },
          { str: 'PDF', x: 50, y: 700, width: 20, size: 10, eol: false },
          { str: '2024', x: 75, y: 700, width: 20, size: 10, eol: false },
          { str: 'قرأت', x: 105, y: 700, width: 30, size: 10, eol: true },
        ],
      },
    ]);
    expect(html).toContain('قرأت PDF 2024 اليوم');
  });

  it('merges the runs of one line, adding spaces only where there are gaps', () => {
    const { html } = layoutPages([
      {
        runs: [
          { str: 'Hel', x: 72, y: 700, width: 15, size: 10, eol: false },
          { str: 'lo', x: 87, y: 700, width: 10, size: 10, eol: false },
          { str: 'world', x: 103, y: 700, width: 25, size: 10, eol: true },
        ],
      },
    ]);
    expect(html).toContain('Hello world');
  });
});

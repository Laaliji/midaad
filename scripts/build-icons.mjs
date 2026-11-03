// Rasterizes assets/brand/icon*.svg into public/icons/*.png
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const out = process.argv[2] ?? 'public/icons';
mkdirSync(out, { recursive: true });
const full = readFileSync('assets/brand/icon.svg', 'utf8');
const small = existsSync('assets/brand/icon-small.svg') ? readFileSync('assets/brand/icon-small.svg', 'utf8') : full;

for (const size of [16, 32, 48, 128]) {
  const svg = size <= 32 ? small : full;
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(`${out}/icon-${size}.png`, png);
}
// Large preview for design review
writeFileSync(`${out}/../icon-preview-512.png`, new Resvg(full, { fitTo: { mode: 'width', value: 512 } }).render().asPng());
console.log('icons written to', out);

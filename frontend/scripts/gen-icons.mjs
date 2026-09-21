// Menghasilkan ikon PWA (192 & 512) sekali jalan: node scripts/gen-icons.mjs
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// "TH" putih di atas latar teal. Sisakan ~12% padding agar aman untuk maskable.
const svg = (size) => {
  const pad = Math.round(size * 0.12);
  const inner = size - pad * 2;
  const fontSize = Math.round(inner * 0.5);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0f766e"/>
  <rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" rx="${Math.round(inner * 0.18)}" fill="#115e59"/>
  <text x="50%" y="50%" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}"
        font-weight="bold" text-anchor="middle" dominant-baseline="central">TH</text>
</svg>`;
};

await mkdir(outDir, { recursive: true });
for (const size of [192, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  await sharp(Buffer.from(svg(size))).png().toFile(file);
  console.log('ditulis', file);
}

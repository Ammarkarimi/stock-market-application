// Renders resources/icon.svg to the 1024px PNG that electron-builder turns into .ico and .icns files, and to the
// sized PNGs in resources/icons that Linux desktops pick from.
// Usage: node scripts/render-icon.mjs  (uses the repository's Playwright; set PLAYWRIGHT_CHROMIUM_PATH if needed)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
async function render(size, file) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true });
  await page.close();
}

await render(1024, path.join(dir, 'icon.png'));
fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) await render(size, path.join(dir, 'icons', `${size}x${size}.png`));
await browser.close();
console.log('Wrote resources/icon.png and resources/icons/*.png');

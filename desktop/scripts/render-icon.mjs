// Renders resources/icon.svg to the 1024px PNG that electron-builder turns into .ico, .icns and Linux icons.
// Usage: node scripts/render-icon.mjs  (uses the repository's Playwright; set PLAYWRIGHT_CHROMIUM_PATH if needed)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body></html>`);
await page.screenshot({ path: path.join(dir, 'icon.png'), omitBackground: true });
await browser.close();
console.log('Wrote resources/icon.png');

#!/usr/bin/env node
/**
 * README screenshots: serves the built app (apps/web/dist), runs the demo keyboards and saves a
 * fixed set of 1440 × 900 pictures to docs/images. Only the firmware simulators are used, so no
 * keyboard plugged into the computer is ever opened.
 *
 *   pnpm build:web && pnpm screenshots
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(import.meta.dirname, '../../apps/web/dist');
const OUT = path.resolve(import.meta.dirname, '../../docs/images');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};
const CHROME =
  process.env.CHROME ??
  [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find(existsSync);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}/`;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const saved = [];

async function session(scheme, fn) {
  const ctx = await browser.newContext({
    colorScheme: scheme,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  try {
    await fn(page);
  } finally {
    await ctx.close();
  }
}

async function shot(page, name) {
  // Let transitions and canvas previews settle.
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  saved.push(`${name}.png`);
}

/** Paints the per-key board left to right through the hue wheel (locally; nothing is applied). */
async function paintRainbow(page) {
  const keys = page.locator('.kb-key');
  await keys.first().waitFor();
  const boxes = await keys.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x));
  const brush = page.getByLabel('Brush');
  const hex = (h) => {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return `#${[f(5), f(3), f(1)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  };
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    await brush.fill(hex(Math.round(((b.x - minX) / (maxX - minX || 1)) * 300 + (b.y % 40))));
    await keys.nth(i).dispatchEvent('pointerdown');
    await keys.nth(i).dispatchEvent('pointerup');
  }
  await page.mouse.move(0, 0);
}

async function demo(page, button = 'Try demo') {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: button }).first().click();
  await page.waitForURL(/#\/overview/);
}

try {
  await session('dark', async (page) => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await shot(page, 'landing');

    await demo(page);
    await page.getByText('What OpenKey concluded').waitFor();
    await shot(page, 'overview');

    await page.goto(base + '#/keymap');
    await page.locator('.kb-key[tabindex="0"]').focus();
    for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight', 'Enter'])
      await page.keyboard.press(k);
    await shot(page, 'keymap');

    await page.goto(base + '#/rgb');
    await page.getByRole('heading', { name: 'Lighting' }).first().waitFor();
    await shot(page, 'lighting');
    await page.getByRole('tab', { name: 'Per-key colour' }).click();
    await paintRainbow(page);
    await shot(page, 'per-key');

    await page.goto(base + '#/macros');
    await page.locator('main h1').first().waitFor();
    // Record a short macro in the browser (kept local; nothing is uploaded).
    await page.getByRole('button', { name: 'Record' }).click();
    const recorder = page.getByLabel('Macro recorder');
    await recorder.focus();
    for (const k of ['Control+c', 'Alt+Tab', 'Control+v', 'Enter']) {
      await page.keyboard.press(k, { delay: 60 });
      await page.waitForTimeout(90);
    }
    // Leaving the recorder box stops recording.
    await page.locator('main h1').first().click();
    await shot(page, 'macros');

    await page.goto(base + '#/screen');
    await page.getByRole('heading', { name: 'Animation gallery' }).waitFor();
    await page
      .locator('.gallery-item')
      .filter({ hasText: 'Plasma' })
      .getByRole('button', { name: 'Use' })
      .click();
    await page.getByText('30 of max 255').waitFor();
    await shot(page, 'screen');

    // Keyboard tester: start it and press a few keys (browser key events only).
    await page.goto(base + '#/tester');
    await page.getByRole('button', { name: 'Start test' }).click();
    for (const k of [
      'KeyO',
      'KeyP',
      'KeyE',
      'KeyN',
      'KeyK',
      'KeyE',
      'KeyY',
      'Space',
      'ShiftLeft',
      'Enter',
    ])
      await page.keyboard.press(k, { delay: 40 });
    await shot(page, 'tester');

    for (const [route, name] of [
      ['#/compat', 'compatibility'],
      ['#/doctor', 'doctor'],
    ]) {
      await page.goto(base + route);
      await page.locator('main h1').first().waitFor();
      await shot(page, name);
    }
  });

  await session('light', async (page) => {
    await demo(page);
    await page.goto(base + '#/keymap');
    await page.locator('.kb-key').first().waitFor();
    await shot(page, 'keymap-light');
    await page.goto(base + '#/rgb');
    await page.getByRole('heading', { name: 'Lighting' }).first().waitFor();
    await shot(page, 'lighting-light');
  });
} finally {
  await browser.close();
  server.close();
}
console.log(`saved ${saved.length} screenshots to docs/images: ${saved.join(', ')}`);

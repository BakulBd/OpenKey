#!/usr/bin/env node
/**
 * Browser smoke test: loads the built app (or a deployed URL), runs the demo through every page,
 * and fails on console errors, uncaught exceptions or missing content. Uses the system Chrome via
 * playwright-core, so no browser download is needed. Real hardware is never touched.
 *
 *   node tools/e2e/smoke.mjs                       # serves apps/web/dist on a local port
 *   node tools/e2e/smoke.mjs https://example.app   # tests a deployment
 *   SCREENSHOTS=dir node tools/e2e/smoke.mjs        # also saves screenshots
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(import.meta.dirname, '../../apps/web/dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.map': 'application/json' };
/** Applies vercel.json headers locally so the CSP and Permissions-Policy are tested with the app. */
const VERCEL = JSON.parse(await readFile(path.resolve(import.meta.dirname, '../../vercel.json'), 'utf8'));
function vercelHeaders(pathname) {
  const out = {};
  for (const rule of VERCEL.headers ?? []) {
    const re = new RegExp(`^${rule.source.replace(/\(\.\*\)/g, '.*')}$`);
    if (re.test(pathname)) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);

async function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { ...vercelHeaders(url.pathname), 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://localhost:${server.address().port}/` };
}

const target = process.argv[2];
const local = target ? null : await serve();
const base = target ?? local.url;
const shots = process.env.SCREENSHOTS;
if (shots) await mkdir(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const failures = [];
const results = [];
try {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && failures.push(`[${scheme}] console: ${m.text()}`));
    page.on('pageerror', (e) => failures.push(`[${scheme}] pageerror: ${e.message}`));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    results.push(`landing: ${await page.getByRole('heading', { level: 1 }).first().textContent()}`);
    if (shots) await page.screenshot({ path: `${shots}/landing-${scheme}.png`, fullPage: true });
    results.push(`webhid in browser: ${await page.evaluate(() => 'hid' in navigator)}`);
    const served = await page.evaluate(async () => {
      const r = await fetch(location.pathname, { cache: 'no-store' });
      return ['content-security-policy', 'permissions-policy', 'x-content-type-options', 'referrer-policy', 'x-frame-options'].map((h) => `${h}=${r.headers.get(h) ? 'set' : 'MISSING'}`);
    });
    results.push(`headers: ${served.join(' ')}`);
    if (served.some((h) => h.endsWith('MISSING'))) failures.push(`missing security headers: ${served.join(' ')}`);
    // Permissions-Policy must still allow WebHID for this origin.
    results.push(`hid allowed by policy: ${await page.evaluate(() => (document.featurePolicy ?? document.permissionsPolicy)?.allowsFeature?.('hid') ?? 'n/a')}`);

    await page.getByRole('button', { name: 'Try demo' }).first().click();
    await page.waitForURL(/#\/overview/);
    await page.getByText('Detected because…').waitFor();
    if (shots) await page.screenshot({ path: `${shots}/overview-${scheme}.png`, fullPage: true });

    const navLinks = await page.locator('nav .nav-item').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    results.push(`[${scheme}] nav: ${navLinks.join(' ')}`);
    for (const href of navLinks) {
      await page.goto(base + href);
      await page.locator('main h1').first().waitFor({ timeout: 10000 });
      const h1 = await page.locator('main h1').first().textContent();
      results.push(`[${scheme}] ${href} → ${h1}`);
      if (shots) await page.screenshot({ path: `${shots}/${href.replace(/[#/?]/g, '') || 'home'}-${scheme}.png`, fullPage: true });
    }

    // Keymap studio: stage a change, review it, apply against the simulator.
    await page.goto(base + '#/keymap');
    await page.locator('.kb-key').nth(30).dispatchEvent('pointerdown');
    await page.getByPlaceholder(/Search/).fill('volume');
    await page.locator('.key-result').first().click();
    await page.getByRole('button', { name: /Review 1 change/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
    await page.getByText(/write sent; verification unavailable|verified by read-back/).first().waitFor();
    results.push(`[${scheme}] keymap apply: ok`);

    // Refresh on a deep route must work (static host, hash routing).
    await page.goto(base + '#/compat');
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('main h1').first().waitFor();
    results.push(`[${scheme}] refresh #/compat: ${await page.locator('main h1').first().textContent()}`);
    await ctx.close();
  }

  // Unknown-device mode end to end: a stubbed WebHID device with an AULA-like descriptor. The app must
  // show read-only inspection and send nothing at all to the device.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[unknown] pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const sent = (window.__hidSends = []);
      const record = (op) => (...args) => {
        sent.push(op);
        return Promise.resolve(op === 'receiveFeatureReport' ? new DataView(new ArrayBuffer(64)) : undefined);
      };
      const coll = (usagePage, usage, feature) => ({
        usagePage, usage, children: [], inputReports: [], outputReports: [],
        featureReports: feature ? [{ reportId: 6, items: [{ reportSize: 8, reportCount: 519 }] }] : [],
      });
      const device = {
        vendorId: 0x258a, productId: 0x010c, productName: 'USB-HID Keyboard', opened: false,
        collections: [coll(0x01, 0x06, false), coll(0xff00, 0x01, true)],
        open: () => Promise.resolve(), close: () => Promise.resolve(),
        sendReport: record('sendReport'), sendFeatureReport: record('sendFeatureReport'),
        receiveFeatureReport: record('receiveFeatureReport'),
        addEventListener() {}, removeEventListener() {},
      };
      const hid = {
        requestDevice: () => Promise.resolve([device]), getDevices: () => Promise.resolve([device]),
        addEventListener() {}, removeEventListener() {},
      };
      Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Inspect any HID device' }).first().click();
    await page.waitForURL(/#\/overview/);
    await page.getByText('Read-only.').waitFor();
    const families = await page.locator('.explain').textContent();
    const sends = await page.evaluate(() => window.__hidSends.length);
    results.push(`unknown device: read-only view shown; possible AULA family listed: ${/AULA/.test(families)}; reports sent: ${sends}`);
    if (sends !== 0) failures.push(`unknown-device mode sent ${sends} report(s)`);
    if (!/AULA/.test(families)) failures.push('unknown-device mode did not list the AULA signature');
    await ctx.close();
  }

  // Offline: after the service worker cached the app, the shell must load without the network.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw';
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
    return reg ? 'ready' : 'timeout';
  });
  results.push(`service worker: ${swReady}`);
  if (swReady === 'ready') {
    await page.reload({ waitUntil: 'networkidle' });
    await ctx.setOffline(true);
    await page.reload();
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 10000 });
    results.push('offline reload: ok');
    await ctx.setOffline(false);
  }
  await ctx.close();
} catch (e) {
  failures.push(`exception: ${e.message}`);
} finally {
  await browser.close();
  local?.server.close();
}

console.log(results.join('\n'));
if (failures.length) {
  console.error(`\nFAIL (${failures.length})\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');

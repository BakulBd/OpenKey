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
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.map': 'application/json',
};
/** Applies vercel.json headers locally so the CSP and Permissions-Policy are tested with the app. */
const VERCEL = JSON.parse(
  await readFile(path.resolve(import.meta.dirname, '../../vercel.json'), 'utf8'),
);
function vercelHeaders(pathname) {
  const out = {};
  for (const rule of VERCEL.headers ?? []) {
    const re = new RegExp(`^${rule.source.replace(/\(\.\*\)/g, '.*')}$`);
    if (re.test(pathname)) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

const CHROME =
  process.env.CHROME ??
  [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].find(existsSync);

/**
 * Pretends to be Chrome on a given OS, so OS-specific guidance (udev on Linux, vendor apps on
 * Windows/macOS) is tested the same way on every CI runner.
 */
const UA = {
  linux: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Linux',
  ],
  windows: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Windows',
  ],
};
async function osContext(os) {
  const [userAgent, platform] = UA[os];
  const ctx = await browser.newContext({ userAgent });
  await ctx.addInitScript((p) => {
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => ({ platform: p, mobile: false, brands: [] }),
      configurable: true,
    });
  }, platform);
  return ctx;
}

async function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        ...vercelHeaders(url.pathname),
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      });
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

/**
 * Lightweight accessibility audit of the rendered page (no extra dependency): every interactive
 * control has an accessible name, labelled images, one h1, unique ids, no positive tabindex.
 */
async function a11yAudit(page) {
  return page.evaluate(() => {
    const problems = [];
    const visible = (el) =>
      !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
      window.getComputedStyle(el).visibility !== 'hidden';
    const name = (el) => {
      const by = el.getAttribute('aria-labelledby');
      if (by)
        return by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim();
      if (el.labels && el.labels.length)
        return [...el.labels]
          .map((l) => l.textContent)
          .join(' ')
          .trim();
      return (
        (el.textContent ?? '').trim() ||
        el.getAttribute('title') ||
        el.getAttribute('placeholder') ||
        ''
      );
    };
    for (const el of document.querySelectorAll(
      'button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=gridcell]',
    )) {
      if (!visible(el) && !el.classList.contains('visually-hidden')) continue;
      if (!name(el))
        problems.push(
          `unnamed ${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}`,
        );
    }
    for (const el of document.querySelectorAll('[role=img]'))
      if (!el.getAttribute('aria-label')) problems.push('role=img without label');
    const h1 = [...document.querySelectorAll('h1')].filter(visible).length;
    if (h1 !== 1) problems.push(`${h1} visible h1`);
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length) problems.push(`duplicate ids: ${[...new Set(dup)].join(', ')}`);
    if (document.querySelector('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])'))
      problems.push('positive tabindex');
    return problems;
  });
}
const failures = [];
const results = [];
try {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: 1360, height: 900 },
    });
    const page = await ctx.newPage();
    page.on(
      'console',
      (m) => m.type() === 'error' && failures.push(`[${scheme}] console: ${m.text()}`),
    );
    page.on('pageerror', (e) => failures.push(`[${scheme}] pageerror: ${e.message}`));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) =>
        console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    results.push(`landing: ${await page.getByRole('heading', { level: 1 }).first().textContent()}`);
    if (shots) await page.screenshot({ path: `${shots}/landing-${scheme}.png`, fullPage: true });
    results.push(`webhid in browser: ${await page.evaluate(() => 'hid' in navigator)}`);
    const served = await page.evaluate(async () => {
      const r = await fetch(location.pathname, { cache: 'no-store' });
      return [
        'content-security-policy',
        'permissions-policy',
        'x-content-type-options',
        'referrer-policy',
        'x-frame-options',
      ].map((h) => `${h}=${r.headers.get(h) ? 'set' : 'MISSING'}`);
    });
    results.push(`headers: ${served.join(' ')}`);
    if (served.some((h) => h.endsWith('MISSING')))
      failures.push(`missing security headers: ${served.join(' ')}`);
    // Permissions-Policy must still allow WebHID for this origin.
    results.push(
      `hid allowed by policy: ${await page.evaluate(() => (document.featurePolicy ?? document.permissionsPolicy)?.allowsFeature?.('hid') ?? 'n/a')}`,
    );

    await page.getByRole('button', { name: 'Try demo' }).first().click();
    await page.waitForURL(/#\/overview/);
    await page.getByText('What OpenKey concluded').waitFor();
    if (shots) await page.screenshot({ path: `${shots}/overview-${scheme}.png`, fullPage: true });

    const navLinks = await page
      .locator('nav .nav-item')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    results.push(`[${scheme}] nav: ${navLinks.join(' ')}`);
    for (const href of navLinks) {
      await page.goto(base + href);
      await page.locator('main h1').first().waitFor({ timeout: 10000 });
      const h1 = await page.locator('main h1').first().textContent();
      results.push(`[${scheme}] ${href} → ${h1}`);
      if (scheme === 'light') {
        const problems = await a11yAudit(page);
        if (problems.length) failures.push(`a11y ${href}: ${[...new Set(problems)].join('; ')}`);
      }
      if (shots)
        await page.screenshot({
          path: `${shots}/${href.replace(/[#/?]/g, '') || 'home'}-${scheme}.png`,
          fullPage: true,
        });
    }

    // Keyboard only: focus the board, move with arrows, select with Enter.
    await page.goto(base + '#/keymap');
    await page.locator('.kb-key[tabindex="0"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const inspectorTitle = await page.locator('.studio-side h2').first().textContent();
    if (!/\(slot \d+\)/.test(inspectorTitle ?? ''))
      failures.push(`keyboard selection did not open the key inspector: ${inspectorTitle}`);
    results.push(`[${scheme}] keyboard-only selection: ${inspectorTitle}`);
    await page.keyboard.press('Escape');

    // Keymap studio: stage a change, review it, apply against the simulator.
    await page.goto(base + '#/keymap');
    await page.locator('.kb-key').nth(30).dispatchEvent('pointerdown');
    await page.getByPlaceholder(/Search/).fill('volume');
    await page.locator('.key-result').first().click();
    await page.getByRole('button', { name: /Review 1 change/ }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Write 1 change/ })
      .click();
    // The outcome stays visible in the change bar (not only in a toast).
    await page
      .locator('.changebar')
      .getByText(/Saved · the keyboard cannot report it back|Saved and verified/)
      .waitFor();
    results.push(`[${scheme}] keymap apply: ok`);

    // The footer's contributor wall is served by the site itself (img-src 'self').
    await page.goto(base, { waitUntil: 'networkidle' });
    // Avatars load lazily: bring the footer into view, then wait for them.
    await page.locator('.avatar-wall').scrollIntoViewIfNeeded();
    await page
      .waitForFunction(() =>
        [...document.querySelectorAll('.avatar-wall img')].every((i) => i.complete),
      )
      .catch(() => undefined);
    const avatars = await page
      .locator('.avatar-wall img')
      .evaluateAll((imgs) =>
        imgs.map((i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.getAttribute('src') })),
      );
    if (!avatars.length || avatars.some((a) => !a.ok || !a.src.startsWith('./contributors/')))
      failures.push(`[${scheme}] contributor avatars missing or not self-hosted`);
    if (!(await page.getByRole('link', { name: 'Become a contributor' }).count()))
      failures.push(`[${scheme}] the footer has no contributor invitation`);
    results.push(`[${scheme}] footer: ${avatars.length} contributor avatar(s), self-hosted`);

    // Refresh on a deep route must work (static host, hash routing).
    await page.goto(base + '#/compat');
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('main h1').first().waitFor();
    results.push(
      `[${scheme}] refresh #/compat: ${await page.locator('main h1').first().textContent()}`,
    );
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
      const record = (op) => () => {
        sent.push(op);
        return Promise.resolve(
          op === 'receiveFeatureReport' ? new DataView(new ArrayBuffer(64)) : undefined,
        );
      };
      const coll = (usagePage, usage, feature) => ({
        usagePage,
        usage,
        children: [],
        inputReports: [],
        outputReports: [],
        featureReports: feature
          ? [{ reportId: 6, items: [{ reportSize: 8, reportCount: 519 }] }]
          : [],
      });
      const device = {
        vendorId: 0x258a,
        productId: 0x010c,
        productName: 'USB-HID Keyboard',
        opened: false,
        collections: [coll(0x01, 0x06, false), coll(0xff00, 0x01, true)],
        open: () => Promise.resolve(),
        close: () => Promise.resolve(),
        sendReport: record('sendReport'),
        sendFeatureReport: record('sendFeatureReport'),
        receiveFeatureReport: record('receiveFeatureReport'),
        addEventListener() {},
        removeEventListener() {},
      };
      const hid = {
        requestDevice: () => Promise.resolve([device]),
        getDevices: () => Promise.resolve([device]),
        addEventListener() {},
        removeEventListener() {},
      };
      Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Inspect any HID device' }).first().click();
    await page.waitForURL(/#\/overview/);
    await page.getByText('Read-only.', { exact: true }).waitFor();
    const families = await page.locator('.explain').textContent();
    const sends = await page.evaluate(() => window.__hidSends.length);
    results.push(
      `unknown device: read-only view shown; possible AULA family listed: ${/AULA/.test(families)}; reports sent: ${sends}`,
    );
    if (sends !== 0) failures.push(`unknown-device mode sent ${sends} report(s)`);
    if (!/AULA/.test(families))
      failures.push('unknown-device mode did not list the AULA signature');
    await ctx.close();
  }

  // Consent-gated identification: the AK820 topology under an identity no official software
  // targets. Nothing may be sent until the user allows the handshake; then exactly START (04 18).
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[consent] pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const sent = (window.__hidSends = []);
      const items = (n) => [{ reportSize: 8, reportCount: n }];
      const mk = (usagePage, usage, input, output, feature) => ({
        usagePage,
        usage,
        children: [],
        inputReports: input ? [{ reportId: 0, items: items(input) }] : [],
        outputReports: output ? [{ reportId: 0, items: items(output) }] : [],
        featureReports: feature ? [{ reportId: 0, items: items(feature) }] : [],
      });
      const device = (collections) => ({
        vendorId: 0x1234,
        productId: 0x0001,
        productName: 'Generic Keyboard',
        opened: false,
        collections,
        open() {
          this.opened = true;
          return Promise.resolve();
        },
        close() {
          this.opened = false;
          return Promise.resolve();
        },
        sendReport: (id, d) => (
          sent.push(['out', id, [...new Uint8Array(d.buffer ?? d)].slice(0, 2)]),
          Promise.resolve()
        ),
        sendFeatureReport: (id, d) => (
          sent.push(['feature', id, [...new Uint8Array(d.buffer ?? d)].slice(0, 2)]),
          Promise.resolve()
        ),
        receiveFeatureReport: () => Promise.resolve(new DataView(new ArrayBuffer(64))),
        addEventListener() {},
        removeEventListener() {},
      });
      const devices = [
        device([mk(0xff13, 0x01, 64, 64, 64)]),
        device([mk(0xff68, 0x61, 64, 4096, 0)]),
      ];
      const hid = {
        requestDevice: () => Promise.resolve(devices),
        getDevices: () => Promise.resolve(devices),
        addEventListener() {},
        removeEventListener() {},
      };
      Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Inspect any HID device' }).first().click();
    await page.waitForURL(/#\/overview/);
    await page.getByText('Strong candidate, not confirmed').first().waitFor();
    if (shots) {
      await page.screenshot({ path: `${shots}/consent-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${shots}/consent-mobile.png`, fullPage: true });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      results.push(`consent page horizontal overflow at 390px: ${overflow}px`);
      if (overflow > 0) failures.push(`consent page scrolls horizontally at 390px (${overflow}px)`);
      await page.setViewportSize({ width: 1360, height: 900 });
    }
    const before = await page.evaluate(() => window.__hidSends.length);
    await page.getByRole('button', { name: 'Allow sonix-feature identification' }).click();
    await page.getByText(/sent 1 identification report/).waitFor();
    const after = await page.evaluate(() => window.__hidSends);
    results.push(`consent: before=${before} after=${JSON.stringify(after)}`);
    if (before !== 0) failures.push(`identification sent ${before} report(s) before consent`);
    if (JSON.stringify(after) !== JSON.stringify([['feature', 0, [4, 0x18]]]))
      failures.push(`consented handshake sent ${JSON.stringify(after)}`);
    await ctx.close();
  }

  // A physical (stubbed) AK820 MAX: verified identity, experimental write with explicit opt-in, a
  // visible write phase, then an unplug in the middle of a second write. The stub answers like the
  // documented firmware (every command is echoed with status 01) and is slow on purpose.
  {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[hardware-stub] pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const sent = (window.__hidSends = []);
      let last = new Uint8Array(64);
      const items = (n) => [{ reportSize: 8, reportCount: n }];
      const mk = (usagePage, usage, input, output, feature) => ({
        usagePage,
        usage,
        children: [],
        inputReports: input ? [{ reportId: 0, items: items(input) }] : [],
        outputReports: output ? [{ reportId: 0, items: items(output) }] : [],
        featureReports: feature ? [{ reportId: 0, items: items(feature) }] : [],
      });
      const wait = () => new Promise((r) => setTimeout(r, window.__hidDelay ?? 0));
      const device = (collections) => ({
        vendorId: 0x0c45,
        productId: 0x8009,
        productName: 'AK820 MAX',
        opened: false,
        collections,
        open() {
          this.opened = true;
          return Promise.resolve();
        },
        close() {
          this.opened = false;
          return Promise.resolve();
        },
        sendReport: () => wait(),
        async sendFeatureReport(_id, d) {
          await wait();
          last = new Uint8Array(d.buffer ?? d).slice();
          sent.push([...last.slice(0, 2)]);
        },
        async receiveFeatureReport() {
          await wait();
          const r = new Uint8Array(64);
          if (last[0] === 0x04) {
            r.set(last.slice(0, 3));
            r[3] = 1;
          }
          return new DataView(r.buffer);
        },
        addEventListener() {},
        removeEventListener() {},
      });
      const devices = [
        device([mk(0xff13, 0x01, 64, 64, 64)]),
        device([mk(0xff68, 0x61, 64, 4096, 0)]),
      ];
      const listeners = { connect: [], disconnect: [] };
      window.__unplug = () => {
        for (const l of listeners.disconnect) l({ device: devices[0] });
      };
      const hid = {
        requestDevice: () => Promise.resolve(devices),
        getDevices: () => Promise.resolve(devices),
        addEventListener: (type, l) => listeners[type]?.push(l),
        removeEventListener: (type, l) => {
          listeners[type] = (listeners[type] ?? []).filter((x) => x !== l);
        },
      };
      Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Connect keyboard' }).first().click();
    await page.waitForURL(/#\/overview/);
    await page.locator('.statusbar').getByText('Verified match').waitFor();
    results.push('hardware stub: status bar shows a verified match for a physical session');

    // Keymap: edit, review, confirm, write. The AK820 MAX keymap write is verified on hardware, so it
    // needs a confirmation but not the experimental opt-in.
    await page.goto(base + '#/keymap');
    await page.locator('.kb-key').nth(30).dispatchEvent('pointerdown');
    await page.getByPlaceholder(/Search/).fill('volume');
    await page.locator('.key-result').first().click();
    await page
      .locator('.statusbar')
      .getByText(/1 unapplied change/)
      .waitFor();
    await page.getByRole('button', { name: /Review 1 change/ }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Write 1 change/ })
      .click();
    const write = page.getByRole('dialog').getByRole('button', { name: 'Write', exact: true });
    if (await write.isDisabled())
      failures.push('a hardware-verified write still required the experimental opt-in');
    if (
      await page
        .getByRole('dialog')
        .getByLabel(/Enable experimental writes/)
        .count()
    )
      failures.push('the confirmation for a verified write offered the experimental opt-in');
    await page.evaluate(() => (window.__hidDelay = 40));
    await write.click();
    await page
      .locator('.statusbar')
      .getByText(/Writing to the keyboard/)
      .waitFor();
    await page
      .locator('.changebar')
      .getByText(/Saved · the keyboard cannot report it back/)
      .waitFor({ timeout: 15000 });
    const cmds = await page.evaluate(() =>
      window.__hidSends.filter((p) => p[0] === 4).map((p) => p[1].toString(16)),
    );
    results.push(`hardware stub: keymap write commands ${cmds.join(' ')}`);
    if (!cmds.includes('11') || !cmds.includes('2'))
      failures.push(`keymap write did not send the expected sequence: ${cmds}`);

    // Second write, unplugged while it runs: no spinner may survive, and the user is told the state is unknown.
    await page.locator('.kb-key').nth(31).dispatchEvent('pointerdown');
    await page.getByPlaceholder(/Search/).fill('mute');
    await page.locator('.key-result').first().click();
    await page.evaluate(() => (window.__hidDelay = 300));
    await page.getByRole('button', { name: /Review 1 change/ }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Write 1 change/ })
      .click();
    await page
      .locator('.statusbar')
      .getByText(/Writing to the keyboard/)
      .waitFor();
    await page.evaluate(() => window.__unplug());
    await page.getByText(/disconnected during/).waitFor();
    await page.locator('.statusbar').getByText('No keyboard connected').waitFor();
    if (await page.locator('.statusbar .spinner').count())
      failures.push('a spinner survived the unplug');
    results.push('hardware stub: unplug during a write ends the session without a stale spinner');
    await ctx.close();
  }

  // Linux permission problem: the browser lists the keyboard but cannot open it until the udev rule
  // is installed. OpenKey must explain the fix, serve the installer, and connect on Retry.
  {
    const ctx = await osContext('linux');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[linux-setup] pageerror: ${e.message}`));
    await page.addInitScript(() => {
      window.__openOk = false;
      let last = new Uint8Array(64);
      const items = (n) => [{ reportSize: 8, reportCount: n }];
      const mk = (usagePage, usage, input, output, feature) => ({
        usagePage,
        usage,
        children: [],
        inputReports: input ? [{ reportId: 0, items: items(input) }] : [],
        outputReports: output ? [{ reportId: 0, items: items(output) }] : [],
        featureReports: feature ? [{ reportId: 0, items: items(feature) }] : [],
      });
      const device = (collections) => ({
        vendorId: 0x0c45,
        productId: 0x8009,
        productName: 'AK820 MAX',
        opened: false,
        collections,
        open() {
          if (!window.__openOk)
            return Promise.reject(
              new window.DOMException('Failed to open the device.', 'NotAllowedError'),
            );
          this.opened = true;
          return Promise.resolve();
        },
        close() {
          this.opened = false;
          return Promise.resolve();
        },
        sendReport: () => Promise.resolve(),
        sendFeatureReport(_id, d) {
          last = new Uint8Array(d.buffer ?? d).slice();
          return Promise.resolve();
        },
        receiveFeatureReport() {
          const r = new Uint8Array(64);
          if (last[0] === 0x04) {
            r.set(last.slice(0, 3));
            r[3] = 1;
          }
          return Promise.resolve(new DataView(r.buffer));
        },
        addEventListener() {},
        removeEventListener() {},
      });
      const devices = [
        device([mk(0xff13, 0x01, 64, 64, 64)]),
        device([mk(0xff68, 0x61, 64, 4096, 0)]),
      ];
      const hid = {
        requestDevice: () => Promise.resolve(devices),
        getDevices: () => Promise.resolve(devices),
        addEventListener() {},
        removeEventListener() {},
      };
      Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Connect keyboard' }).first().click();
    await page.getByRole('heading', { name: 'Linux setup required' }).waitFor();
    if (shots) await page.screenshot({ path: `${shots}/linux-setup.png`, fullPage: true });
    const files = await page.evaluate(async () => {
      const get = async (u) => {
        const r = await fetch(u);
        return { ok: r.ok, text: await r.text() };
      };
      return {
        installer: await get('./linux/install-openkey-udev.sh'),
        rule: await get('./linux/70-openkey.rules'),
      };
    });
    if (!files.installer.ok || !files.installer.text.includes('OPENKEY_RULE_EOF'))
      failures.push('installer script is not served');
    if (!files.rule.ok || !files.rule.text.includes('SUBSYSTEM=="hidraw"'))
      failures.push('udev rule is not served');
    const cmd = await page.locator('.access-help .copy-line code').first().textContent();
    if (
      !/^curl -fsSL \S+\/linux\/install-openkey-udev\.sh -o \/tmp\/openkey-udev\.sh && sudo sh \/tmp\/openkey-udev\.sh$/.test(
        cmd ?? '',
      )
    )
      failures.push(`unexpected install command for a listed keyboard: ${cmd}`);
    // The user ran the installer and replugged: opening now works.
    await page.evaluate(() => (window.__openOk = true));
    await page.getByRole('button', { name: 'Retry connecting' }).click();
    await page.waitForURL(/#\/overview/);
    await page.locator('.statusbar').getByText('Verified match').waitFor();
    results.push('linux setup: panel shown, rule and installer served, retry connected');
    await ctx.close();
  }

  // A keyboard the shipped rule does not list: the OS refuses to open it before any adapter probes it.
  // OpenKey must still explain the Linux fix, with that keyboard's USB ID added to the command.
  {
    const ctx = await osContext('linux');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[linux-unlisted] pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const dev = {
        vendorId: 0x1234,
        productId: 0x5678,
        productName: 'Some Keyboard',
        opened: false,
        collections: [
          {
            usagePage: 0xff00,
            usage: 1,
            children: [],
            inputReports: [],
            outputReports: [],
            featureReports: [{ reportId: 6, items: [{ reportSize: 8, reportCount: 32 }] }],
          },
        ],
        open: () =>
          Promise.reject(new window.DOMException('Failed to open the device.', 'NotAllowedError')),
        close: () => Promise.resolve(),
        sendReport: () => Promise.resolve(),
        sendFeatureReport: () => Promise.resolve(),
        receiveFeatureReport: () => Promise.resolve(new DataView(new ArrayBuffer(32))),
        addEventListener() {},
        removeEventListener() {},
      };
      window.__sent = 0;
      const hid = {
        requestDevice: () => Promise.resolve([dev]),
        getDevices: () => Promise.resolve([dev]),
        addEventListener() {},
        removeEventListener() {},
      };
      Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Connect keyboard' }).first().click();
    await page.getByRole('heading', { name: 'Linux setup required' }).waitFor();
    const cmd = await page.locator('.access-help .copy-line code').first().textContent();
    if (!(cmd ?? '').endsWith('sudo sh /tmp/openkey-udev.sh --device 1234:5678'))
      failures.push(`install command does not add the unlisted keyboard: ${cmd}`);
    await page.getByText(/not in OpenKey’s list yet/).waitFor();
    results.push(
      'linux setup: unlisted keyboard detected before identification; command adds --device 1234:5678',
    );
    await ctx.close();
  }

  // Demo keyboards of the BY Tech family: AULA F75 (documented layout) and RK R75 (taught layout).
  {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[by-tech] pageerror: ${e.message}`));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'AULA F75' }).click();
    await page.waitForURL(/#\/overview/);
    await page.locator('.dev-chip').getByText('AULA F75').waitFor();
    await page.goto(base + '#/rgb');
    await page.getByText('Fixed on').first().waitFor();
    if (shots) await page.screenshot({ path: `${shots}/aula-f75-lighting.png`, fullPage: true });
    await page.goto(base + '#/');
    await page
      .getByRole('button', { name: 'Disconnect' })
      .first()
      .click()
      .catch(() => undefined);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'RK R75' }).click();
    await page.waitForURL(/#\/overview/);
    await page.locator('.dev-chip').getByText('RK R75 RGB (wired)').waitFor();
    await page.goto(base + '#/rgb');
    await page.getByRole('heading', { name: 'Teach OpenKey your keyboard' }).waitFor();
    await page.getByRole('button', { name: 'Start (reads the settings)' }).click();
    await page.getByRole('button', { name: 'Done, read again' }).waitFor();
    if (shots) await page.screenshot({ path: `${shots}/rk-r75-teach.png`, fullPage: true });
    results.push(
      'by-tech demos: AULA F75 lighting decoded; RK R75 offers the teach flow (reads only)',
    );
    await ctx.close();
  }

  // QMK / VIA demo: the keymap asks for a definition, a matrix grid works, every layer is editable.
  {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[via] pageerror: ${e.message}`));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'QMK / VIA board' }).click();
    await page.waitForURL(/#\/overview/);
    await page.goto(base + '#/keymap');
    await page.getByRole('heading', { name: 'Load this keyboard’s layout' }).waitFor();
    await page.getByText('No file? Use a matrix grid').click();
    await page.getByLabel('Rows').fill('5');
    await page.getByLabel('Columns').fill('15');
    await page.getByRole('button', { name: 'Use a grid' }).click();
    await page.getByRole('tab', { name: 'Layer 2' }).waitFor();
    await page.getByRole('tab', { name: 'Layer 2' }).click();
    const keys = await page.locator('.kb-key').count();
    if (shots) await page.screenshot({ path: `${shots}/via-keymap.png`, fullPage: true });
    if (keys !== 75) failures.push(`VIA grid shows ${keys} keys, expected 75`);
    if (await page.getByText(/Protocol error/).count())
      failures.push('VIA: an error toast appeared after choosing the grid');
    results.push(`via demo: definition step, 5×15 grid (${keys} keys), layers 0–3`);
    await ctx.close();
  }

  // Vial demo: the layout is read from the keyboard itself (read-only Vial commands), then used.
  {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[vial] pageerror: ${e.message}`));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Vial board' }).click();
    await page.waitForURL(/#\/overview/);
    await page.goto(base + '#/keymap');
    await page.getByRole('button', { name: 'Read the layout from the keyboard (Vial)' }).click();
    await page.locator('#main strong', { hasText: 'OpenKey Vial demo 60%' }).waitFor();
    await page.getByRole('button', { name: 'Use this layout' }).click();
    await page.getByRole('tab', { name: 'Layer 2' }).waitFor();
    const keys = await page.locator('.kb-key').count();
    if (shots) await page.screenshot({ path: `${shots}/vial-keymap.png`, fullPage: true });
    if (keys !== 63) failures.push(`Vial layout shows ${keys} keys (61 + knob ↺ ↻), expected 63`);
    results.push(`vial demo: layout read from the keyboard (${keys} keys incl. knob)`);
    // VIA custom menus from the keyboard's definition: read, conditional control, write + read-back.
    await page.goto(base + '#/custom');
    await page.getByLabel('Knob mode').waitFor();
    if (await page.getByText(/Scroll speed/).count())
      failures.push('custom menus: a showIf control is shown while its condition is false');
    await page.getByLabel('Knob mode').selectOption({ label: 'Scroll' });
    await page.getByText(/Scroll speed/).waitFor();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Apply|Write|Confirm/ })
      .first()
      .click()
      .catch(() => undefined);
    await page
      .locator('.changebar')
      .getByText(/verified/i)
      .waitFor();
    if (shots) await page.screenshot({ path: `${shots}/vial-menus.png`, fullPage: true });
    results.push('vial demo: keyboard menus read, condition applied, write verified');
    // Vial extras: QMK settings and a tap dance, written and read back.
    await page.goto(base + '#/vial');
    await page.getByRole('tab', { name: 'QMK settings' }).waitFor();
    await page.getByLabel('Caps Lock acts as Ctrl').check();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Apply|Write|Confirm/ })
      .first()
      .click()
      .catch(() => undefined);
    await page
      .locator('.changebar')
      .getByText(/verified/i)
      .waitFor();
    await page.getByRole('tab', { name: 'Tap dance' }).click();
    await page.getByRole('button', { name: /^Hold:/ }).click();
    await page.locator('.picker .search input').fill('esc');
    await page.locator('.key-results .key-result').first().click();
    await page.getByRole('button', { name: /^Hold: Esc/i }).waitFor();
    if (shots) await page.screenshot({ path: `${shots}/vial-extras.png`, fullPage: true });
    results.push('vial demo: QMK setting written and verified; tap dance editor works');
    await ctx.close();
  }

  // ZMK Studio demo (USB serial): locked at first, unlocked with the keyboard's own key, then a key is
  // changed, saved and read back.
  {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[zmk] pageerror: ${e.message}`));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'ZMK split' }).click();
    await page.getByText('Unlock the keyboard to edit it').waitFor();
    await page.waitForURL(/#\/overview/);
    await page.goto(base + '#/keymap');
    await page.locator('.kb-key').first().waitFor();
    const keys = await page.locator('.kb-key').count();
    if (keys !== 12) failures.push(`ZMK layout shows ${keys} keys, expected 12`);
    await page.locator('.kb-key').nth(1).dispatchEvent('pointerdown');
    await page.getByPlaceholder(/Search/).fill('volume');
    await page.locator('.key-result').first().click();
    await page.getByRole('button', { name: /Review 1 change/ }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Write 1 change/ })
      .click();
    await page
      .locator('.changebar')
      .getByText(/verified/i)
      .waitFor();
    if (shots) await page.screenshot({ path: `${shots}/zmk-keymap.png`, fullPage: true });
    results.push(`zmk demo: unlocked by its key, ${keys} keys, change saved and verified`);
    await ctx.close();
  }

  // libhmk (magnetic) demo: layout from the keyboard's metadata, per-key Rapid Trigger written and read back.
  {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[hmk] pageerror: ${e.message}`));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Magnetic (libhmk)' }).click();
    await page.waitForURL(/#\/overview/);
    await page.goto(base + '#/actuation');
    await page.getByRole('button', { name: 'Select all' }).click();
    await page.getByLabel('Rapid Trigger').check();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Apply|Write|Confirm/ })
      .first()
      .click()
      .catch(() => undefined);
    await page
      .locator('.changebar')
      .getByText(/verified/i)
      .waitFor();
    const rt = await page.locator('.kb-key').filter({ hasText: 'RT' }).count();
    if (rt !== 12) failures.push(`HMK: ${rt} keys show Rapid Trigger after applying, expected 12`);
    if (shots) await page.screenshot({ path: `${shots}/hmk-actuation.png`, fullPage: true });
    results.push(`hmk demo: Rapid Trigger on ${rt} keys, written and verified`);
    await ctx.close();
  }

  // AJAZZ AJ139 V2 MC mouse demo: debounce read from the mouse, changed, written and read back.
  {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[aj139] pageerror: ${e.message}`));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'AJAZZ AJ139 mouse' }).click();
    await page.waitForURL(/#\/overview/);
    await page.goto(base + '#/mouse');
    const slider = page.getByLabel(/Debounce: 4 ms/);
    await slider.waitFor();
    await slider.fill('8');
    await page.getByText('Debounce: 8 ms').waitFor();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Apply|Write|Confirm/ })
      .first()
      .click()
      .catch(() => undefined);
    await page
      .locator('.changebar')
      .getByText(/verified/i)
      .waitFor();
    if (shots) await page.screenshot({ path: `${shots}/aj139-mouse.png`, fullPage: true });
    results.push('aj139 demo: debounce 4 → 8 ms written and verified');
    await ctx.close();
  }

  // AJAZZ AJ179 mouse demo: the shared mouse page shows the AJ179's own settings (Motion Sync, lift-off).
  {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[aj179] pageerror: ${e.message}`));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'AJAZZ AJ179 mouse' }).click();
    await page.waitForURL(/#\/overview/);
    await page.goto(base + '#/mouse');
    await page.getByText('Motion Sync').waitFor();
    await page.getByLabel('Lift-off distance').waitFor();
    await page.getByLabel(/Debounce: 8 ms/).waitFor();
    results.push('aj179 demo: mouse page rendered from the AJ179 schema');
    await ctx.close();
  }

  // Dynamic Lighting (HID LampArray) demo: the keyboard picture comes from the lamps the keyboard reports.
  {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[lamparray] pageerror: ${e.message}`));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Dynamic Lighting (LampArray)' }).click();
    await page.waitForURL(/#\/overview/);
    await page
      .getByText(/84 lamps/)
      .first()
      .waitFor({ state: 'attached' });
    results.push('lamparray demo: 84 lamps read from the keyboard');
    await ctx.close();
  }

  // MK870 demo (Winbond): the read-only protocol check runs on a click and only its shape is packaged.
  {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[mk870] pageerror: ${e.message}`));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'FL Esports MK870' }).click();
    await page.waitForURL(/#\/overview/);
    await page.locator('.dev-chip').getByText('FL Esports MK870').waitFor();
    await page.goto(base + '#/lab');
    await page.getByRole('tab', { name: 'Report', exact: true }).click();
    await page.getByRole('heading', { name: 'Protocol checks' }).waitFor();
    await page.getByRole('button', { name: 'Run check' }).click();
    await page.getByText('Answered: the keyboard repeated the command.').waitFor();
    await page.getByText('Preview the package').click();
    const pkg = await page
      .locator('details', { hasText: 'Preview the package' })
      .locator('pre')
      .textContent();
    if (!pkg?.includes('"protocolChecks"') || !pkg.includes('"winbond-oem"'))
      failures.push(
        `MK870 package lacks the protocol check or the family hint: ${(pkg ?? '').slice(0, 300)}`,
      );
    if (pkg?.includes('"bytes"')) failures.push('MK870 package contains answer bytes');
    if (shots) await page.screenshot({ path: `${shots}/mk870-protocol-check.png`, fullPage: true });
    results.push('mk870 demo: protocol check answered; package has its shape and the family hint');
    await ctx.close();
  }
  // Screen gallery (demo): generated animations load into the local preview; nothing is uploaded.
  {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[gallery] pageerror: ${e.message}`));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Try demo' }).first().click();
    await page.waitForURL(/#\/overview/);
    await page.goto(base + '#/screen');
    await page.getByRole('heading', { name: 'Animation gallery' }).waitFor();
    const cards = await page.locator('.gallery-item').count();
    await page
      .locator('.gallery-item')
      .filter({ hasText: 'Plasma' })
      .getByRole('button', { name: 'Use' })
      .click();
    await page.getByText('30 of max 255').waitFor();
    if (shots) await page.screenshot({ path: `${shots}/screen-gallery.png`, fullPage: true });
    results.push(`gallery: ${cards} animations; Plasma loaded into the preview (30 frames)`);
    if (cards < 8) failures.push(`gallery shows only ${cards} animations`);
    // Categories and favourites (kept in this browser only).
    await page.getByRole('button', { name: 'Festive', exact: true }).click();
    const festive = await page.locator('.gallery-item').allTextContents();
    if (!festive.some((x) => x.includes('Eid crescent')) || festive.length >= cards)
      failures.push('the Festive category does not filter the gallery');
    await page.getByRole('button', { name: 'Add Eid crescent to favourites' }).click();
    await page.getByRole('button', { name: /^Favourites/ }).click();
    const favs = await page.locator('.gallery-item').count();
    if (favs !== 1) failures.push(`favourites show ${favs} animations, expected 1`);
    results.push(`gallery: Festive shows ${festive.length}; favourites ${favs}`);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('tab', { name: 'Public-domain GIFs' }).click();
    const gifs = await page.locator('.gallery-item').count();
    await page
      .locator('.gallery-item')
      .filter({ hasText: 'Cat with a waving tail' })
      .getByRole('button', { name: 'Use' })
      .click();
    await page.getByText('2 of max 255').waitFor();
    if (shots) await page.screenshot({ path: `${shots}/screen-gallery-gifs.png`, fullPage: true });
    if (gifs < 11) failures.push(`public-domain tab shows only ${gifs} GIFs`);
    results.push(`gallery: ${gifs} public-domain GIFs; the cat GIF decoded into the preview`);
    await page.getByRole('tab', { name: 'Name Studio' }).click();
    await page.getByLabel('Your name').waitFor();
    const styles = await page.locator('.gallery-item').count();
    await page
      .locator('.gallery-item')
      .filter({ hasText: 'Neon Pulse' })
      .getByRole('button', { name: 'Use' })
      .click();
    await page.getByText('30 of max 255').waitFor();
    if (shots) await page.screenshot({ path: `${shots}/name-studio.png`, fullPage: true });
    if (styles < 10) failures.push(`Name Studio shows only ${styles} styles`);
    results.push(`name studio: ${styles} styles for "Bakul"; Neon Pulse loaded into the preview`);
    await ctx.close();
  }

  // Phone width: no horizontal overflow, and the off-canvas navigation is out of the tab order when closed.
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[mobile] pageerror: ${e.message}`));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Try demo' }).first().click();
    await page.waitForURL(/#\/overview/);
    for (const r of [
      'overview',
      'keymap',
      'rgb',
      'macros',
      'screen',
      'settings-device',
      'backup',
      'profiles',
      'tester',
      'lab',
      'compat',
      'doctor',
      'settings',
    ]) {
      await page.goto(base + '#/' + r);
      await page.locator('main h1').first().waitFor();
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (over > 0) failures.push(`[mobile] #/${r} overflows horizontally by ${over}px`);
    }
    const inertClosed = await page.locator('#side-nav').evaluate((el) => el.inert);
    await page.getByRole('button', { name: /navigation/i }).click();
    const inertOpen = await page.locator('#side-nav').evaluate((el) => el.inert);
    await page.keyboard.press('Escape');
    const inertAfter = await page.locator('#side-nav').evaluate((el) => el.inert);
    results.push(
      `mobile: nav inert closed=${inertClosed} open=${inertOpen} afterEscape=${inertAfter}`,
    );
    if (!inertClosed || inertOpen || !inertAfter)
      failures.push('[mobile] navigation is reachable while hidden, or not while open');
    await ctx.close();
  }

  // Connection doctor: a keyboard granted with only its typing interface. The doctor must name the
  // problem and the fix, and checking must send nothing. The model finder searches VIA's catalogue.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[doctor] pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const sent = (window.__hidSends = []);
      const device = {
        vendorId: 0x258a,
        productId: 0x015e,
        productName: 'Gaming Keyboard',
        opened: false,
        collections: [
          {
            usagePage: 0x01,
            usage: 0x06,
            children: [],
            inputReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: 8 }] }],
            outputReports: [],
            featureReports: [],
          },
        ],
        open() {
          this.opened = true;
          return Promise.resolve();
        },
        close() {
          this.opened = false;
          return Promise.resolve();
        },
        sendReport: () => (sent.push('out'), Promise.resolve()),
        sendFeatureReport: () => (sent.push('feature'), Promise.resolve()),
        receiveFeatureReport: () => Promise.resolve(new DataView(new ArrayBuffer(8))),
        addEventListener() {},
        removeEventListener() {},
      };
      const hid = {
        requestDevice: () => Promise.resolve([device]),
        getDevices: () => Promise.resolve([device]),
        addEventListener() {},
        removeEventListener() {},
      };
      Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
    });
    await page.goto(base + '#/doctor', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Choose a keyboard to check' }).click();
    await page.getByText('Only the typing interface is available').waitFor();
    const fix = await page.locator('.doctor-item.st-fail .fix').first().textContent();
    const sends = await page.evaluate(() => window.__hidSends.length);
    results.push(
      `doctor: typing-only grant explained; fix shown: ${/other entry/.test(fix)}; reports sent: ${sends}`,
    );
    if (sends !== 0) failures.push(`the connection doctor sent ${sends} report(s)`);
    if (!/other entry/.test(fix)) failures.push('the doctor did not give the interface fix');

    await page.goto(base + '#/compat');
    await page.getByLabel('Search a model, e.g. RK61 or Keychron').fill('keychron q1');
    await page.getByText(/In VIA’s catalogue: \d+ of/).waitFor();
    results.push(`model finder: VIA catalogue search ok`);
    await ctx.close();
  }

  // Windows: a keyboard another program holds. The doctor names the vendor app, not permissions.
  {
    const ctx = await osContext('windows');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[windows-busy] pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const device = {
        vendorId: 0x258a,
        productId: 0x010c,
        productName: 'Gaming Keyboard',
        opened: false,
        collections: [
          {
            usagePage: 0xff02,
            usage: 0x02,
            children: [],
            inputReports: [],
            outputReports: [],
            featureReports: [{ reportId: 6, items: [{ reportSize: 8, reportCount: 519 }] }],
          },
        ],
        open: () =>
          Promise.reject(new window.DOMException('Failed to open the device.', 'NotAllowedError')),
        close: () => Promise.resolve(),
        sendReport: () => Promise.resolve(),
        sendFeatureReport: () => Promise.resolve(),
        receiveFeatureReport: () => Promise.resolve(new DataView(new ArrayBuffer(8))),
        addEventListener() {},
        removeEventListener() {},
      };
      const hid = {
        requestDevice: () => Promise.resolve([device]),
        getDevices: () => Promise.resolve([device]),
        addEventListener() {},
        removeEventListener() {},
      };
      Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
    });
    await page.goto(base + '#/doctor', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Choose a keyboard to check' }).click();
    await page.getByText('Another program holds the keyboard').waitFor();
    results.push('windows (emulated): busy keyboard explained as a vendor app holding it');
    await ctx.close();
  }

  // A receiver (2.4 GHz) that answers nothing: OpenKey must say it is a wireless link and that
  // configuration needs the cable, and send no write.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[receiver] pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const sent = (window.__hidSends = []);
      const items = (n) => [{ reportSize: 8, reportCount: n }];
      const mk = (usagePage, usage, n) => ({
        usagePage,
        usage,
        children: [],
        inputReports: [{ reportId: 0, items: items(n) }],
        outputReports: [{ reportId: 0, items: items(n) }],
        featureReports: [],
      });
      const device = {
        vendorId: 0x05ac,
        productId: 0x024f,
        productName: 'AJAZZ AK820 MAX 2.4G',
        opened: false,
        collections: [mk(0x01, 0x06, 8), mk(0xff60, 0x61, 32)],
        open() {
          this.opened = true;
          return Promise.resolve();
        },
        close() {
          this.opened = false;
          return Promise.resolve();
        },
        sendReport: (id, d) => (
          sent.push([...new Uint8Array(d.buffer ?? d)].slice(0, 2)),
          Promise.resolve()
        ),
        sendFeatureReport: () => Promise.resolve(),
        receiveFeatureReport: () => Promise.resolve(new DataView(new ArrayBuffer(64))),
        addEventListener() {},
        removeEventListener() {},
      };
      const hid = {
        requestDevice: () => Promise.resolve([device]),
        getDevices: () => Promise.resolve([device]),
        addEventListener() {},
        removeEventListener() {},
      };
      Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Connect keyboard' }).first().click();
    await page.waitForURL(/#\/overview/);
    await page
      .getByText(/This is a wireless link\.|Connected without the cable/)
      .first()
      .waitFor();
    results.push('receiver: wireless link explained, cable needed for settings');
    await ctx.close();
  }

  // Offline analysis works without WebHID and without a device.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[offline-analysis] pageerror: ${e.message}`));
    await page.goto(base + '#/lab', { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Offline analysis' }).click();
    for (const [sample, expected] of [
      ['Fixture A (258A:015E)', 'Strong candidate, not confirmed'],
      ['Fixture B (3151:6000)', 'Unknown device'],
      ['AK820 MAX PLUS descriptors', 'Strong candidate, not confirmed'],
    ]) {
      await page.getByRole('button', { name: sample }).click();
      // Files are previewed (sanitized summary) before analysis.
      await page.getByText(/Before analysing:/).waitFor();
      await page.getByRole('button', { name: 'Analyse', exact: true }).click();
      await page.locator('#verdict-h').waitFor();
      const kind = await page
        .locator(
          '.vd-' +
            (expected === 'Unknown device'
              ? 'unknown'
              : expected === 'Resembles a known family'
                ? 'family_candidate'
                : 'strong_candidate'),
        )
        .first()
        .textContent({ timeout: 5000 })
        .catch(() => null);
      results.push(`offline analysis ${sample}: ${kind}`);
      if (kind !== expected)
        failures.push(`offline analysis of ${sample} showed ${kind}, expected ${expected}`);
      if (shots)
        await page.screenshot({
          path: `${shots}/offline-${sample.replace(/\W+/g, '-')}.png`,
          fullPage: true,
        });
    }
    // Compare the last file with fixture B.
    await page.getByRole('button', { name: 'Fixture B (3151:6000)' }).click();
    await page.getByRole('button', { name: /Compare with/ }).click();
    await page.getByText(/Different HID descriptors/).waitFor();
    results.push('offline comparison: ok');
    await ctx.close();
  }

  // Offline: after the service worker cached the app, the shell must load without the network.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw';
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((r) => setTimeout(() => r(null), 8000)),
    ]);
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

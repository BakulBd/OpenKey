import { describe, expect, it } from 'vitest';
import { MemoryStateStore, isOpenKeyError, runDoctor } from '@openkey/core';
import { lookupCatalog } from '@openkey/devices';
import { MockHidDevice } from '@openkey/hid';
import type { HidCollection } from '@openkey/hid';
import {
  connectKeyboard,
  createDefaultRegistry,
  detectionVerdict,
  sonixDongle,
} from '@openkey/protocols';
import { noSleep } from '../helpers.js';

const col = (
  usagePage: number,
  usage: number,
  inputReports: { reportId: number; size: number }[] = [],
  outputReports: { reportId: number; size: number }[] = [],
): HidCollection => ({ usagePage, usage, inputReports, outputReports, featureReports: [] });

/** The AULA NOVA75 receiver as a user's macOS diagnostic reported it: no vendor page at all. */
const NOVA75_RX = [
  [col(0x01, 0x02)],
  [col(0x0c, 0x01, [{ reportId: 8, size: 2 }])],
  [col(0x0c, 0x01, [{ reportId: 17, size: 1 }])],
  [col(0x01, 0x0e, [{ reportId: 9, size: 8 }])],
];

function receiver(productName: string, collections: HidCollection[][]) {
  return new MockHidDevice(
    { vendorId: 0x05ac, productId: 0x024f, productName },
    collections.map((c) => ({
      info: { collections: c },
      behavior: { onOutput: () => undefined, onFeatureSet: () => undefined },
    })),
  );
}

describe('05AC:024F, a receiver identity several brands share', () => {
  it('names each receiver by its product string, never one brand for all', () => {
    expect(
      lookupCatalog({ vendorId: 0x05ac, productId: 0x024f, productName: 'AULA-NOVA75-2' }),
    ).toMatchObject({ brand: 'AULA', model: 'NOVA75 2.4 GHz receiver' });
    expect(
      lookupCatalog({ vendorId: 0x05ac, productId: 0x024f, productName: 'AJAZZ AK820 MAX 2.4G' }),
    ).toMatchObject({ brand: 'AJAZZ' });
    expect(
      lookupCatalog({ vendorId: 0x05ac, productId: 0x024f, productName: 'Some 2.4G Receiver' }),
    ).toMatchObject({ brand: 'Generic' });
  });

  it('inspects the AULA NOVA75 receiver without sending anything, and says why', async () => {
    const dev = receiver('AULA-NOVA75-2', NOVA75_RX);
    const registry = createDefaultRegistry();
    const report = await registry.detect(dev.group(), { level: 'handshake' });
    expect(dev.traffic.filter((t) => t.op !== 'feature-get')).toEqual([]);
    expect(report.selected).toBeNull();
    expect(report.notes.join(' ')).toMatch(/AULA NOVA75 2\.4 GHz receiver/);
    expect(detectionVerdict(report, registry).writeEligible).toBe(false);
  });

  it('the doctor explains a receiver whose configuration channel macOS may hide', () => {
    const checks = runDoctor({
      runtime: 'browser',
      os: 'macos',
      webHid: true,
      secureContext: true,
      device: {
        vendorId: 0x05ac,
        productId: 0x024f,
        productName: 'AULA-NOVA75-2',
        interfaces: NOVA75_RX.map((cs) =>
          cs.map((c) => ({
            usagePage: c.usagePage,
            usage: c.usage,
            featureReports: 0,
            outputReports: 0,
          })),
        ),
        openError: null,
        known: [{ model: 'AULA NOVA75 2.4 GHz receiver', link: '2.4ghz', family: 'unknown' }],
      },
    });
    expect(checks.find((c) => c.id === 'link')?.fix).toMatch(/USB cable/);
    expect(checks.find((c) => c.id === 'interface')?.title).toMatch(/No vendor configuration/);
    // macOS can hide a receiver's vendor endpoints from the browser: say so, with the fix.
    const hidden = checks.find((c) => c.id === 'receiver-hidden')!;
    expect(hidden.status).toBe('warn');
    expect(hidden.fix).toMatch(/Input Monitoring/);
  });

  it('asks once before pinging a receiver whose name no official driver lists', async () => {
    // A receiver on the same identity that does expose a 32-byte vendor collection.
    const dev = receiver('AULA-NOVA75-2', [
      ...NOVA75_RX,
      [col(0xff02, 0x01, [{ reportId: 0, size: 32 }], [{ reportId: 0, size: 32 }])],
    ]);
    const report = await createDefaultRegistry().detect(dev.group(), { level: 'handshake' });
    expect(dev.traffic.filter((t) => t.op === 'output' || t.op === 'feature-set')).toEqual([]);
    const c = report.candidates.find((x) => x.protocol.id === 'sonix-dongle');
    expect(c?.consent).toMatchObject({ required: true, granted: false });
  });

  it('does not blame macOS when the receiver shows its vendor endpoints, or on other systems', () => {
    const base = {
      vendorId: 0x05ac,
      productId: 0x024f,
      productName: 'AULA-NOVA75-2',
      openError: null,
      known: [{ model: 'receiver', link: '2.4ghz' as const, family: 'unknown' }],
    };
    const typing = [[{ usagePage: 0x0c, usage: 1, featureReports: 0, outputReports: 0 }]];
    const vendor = [
      ...typing,
      [{ usagePage: 0xff60, usage: 0x61, featureReports: 0, outputReports: 1 }],
    ];
    const ids = (os: 'macos' | 'windows', interfaces: typeof typing) =>
      runDoctor({ runtime: 'cli', os, device: { ...base, interfaces } }).map((c) => c.id);
    expect(ids('macos', vendor)).not.toContain('receiver-hidden');
    expect(ids('windows', typing)).not.toContain('receiver-hidden');
  });
});

/** A NOVA75 receiver whose FF60 endpoint is visible (Windows, Linux, macOS with Input Monitoring). */
function nova75Receiver(productName = 'AULA-NOVA75-2', battery = 85) {
  const dev = new MockHidDevice(
    { vendorId: 0x05ac, productId: 0x024f, productName },
    [
      ...NOVA75_RX.map((c) => ({
        info: { collections: c },
        behavior: {},
      })),
      {
        info: {
          collections: [
            col(0xff60, 0x61, [{ reportId: 0, size: 32 }], [{ reportId: 0, size: 32 }]),
          ],
        },
        behavior: {
          onOutput: (_id, data, ctx) => {
            if (data[0] === 0x20 && data[1] === 0x01)
              ctx.emitInput(new Uint8Array([0x20, 0x01, 0x00, battery, ...new Array(28).fill(0)]));
          },
        },
      },
    ],
    '2.4ghz',
  );
  return dev;
}

async function connectNova75(allowExperimental = true) {
  const dev = nova75Receiver();
  const kb = await connectKeyboard(dev.group(), {
    registry: createDefaultRegistry(),
    consent: ['sonix-dongle'],
    store: new MemoryStateStore(),
    cmdDelayMs: 0,
    sleep: noSleep,
    allowExperimental,
  });
  const outputs = () => dev.traffic.filter((t) => t.op === 'output').map((t) => Array.from(t.data));
  return { dev, outputs, ...kb };
}

describe('AULA NOVA75 over its 2.4 GHz receiver', () => {
  it('pings without asking when the receiver uses the name the official NOVA75 driver lists', () => {
    const plan = sonixDongle.sonixDongleProtocol.probePlan;
    expect(plan.autoConsent?.(nova75Receiver('2.4G Dongle').group()).auto).toBe(true);
    expect(plan.autoConsent?.(nova75Receiver('AULA-NOVA75-2').group()).auto).toBe(false);
  });

  it('names the NOVA75, with its 80 keys, 0–6 lighting levels and battery', async () => {
    const { driver } = await connectNova75();
    const info = await driver.getDeviceInfo();
    expect(info).toMatchObject({ model: 'AULA NOVA75 2.4 GHz receiver', transport: '2.4ghz' });
    expect(driver.getLayout().keys).toHaveLength(80);
    expect(driver.getRgbEffects().brightness.max).toBe(6);
    expect(driver.getRgbEffects().speed.max).toBe(6);
    expect(await driver.getBattery()).toEqual({ level: 85, charging: false });
    const caps = driver.getCapabilities();
    expect(caps.tft.write).toBe(false);
    expect(caps.perKeyRgb.write).toBe(false);
    expect(caps.macros.write).toBe(false);
    expect([caps.sleep.write, caps.keyResponse.write, caps.gameMode.write]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('sends the lighting preamble, then the lighting packet', async () => {
    const { driver, outputs } = await connectNova75();
    const before = outputs().length;
    await driver.setRgbConfig({
      effect: 1,
      color: { r: 0, g: 128, b: 255 },
      colorful: false,
      brightness: 6,
      speed: 3,
      direction: 'right',
    });
    const [pre, light] = outputs().slice(before);
    expect(pre).toEqual(Array.from(sonixDongle.donglePacket([0x0f])));
    expect(light!.slice(0, 19)).toEqual([
      5, 0x10, 0, 1, 0, 128, 255, 0, 0, 0, 0, 0, 6, 3, 1, 0, 0, 0xaa, 0x55,
    ]);
    expect(light![31]).toBe(sonixDongle.dongleChecksum(new Uint8Array(light!)));
  });

  it('writes sleep, key response and game mode in one settings packet and remembers them', async () => {
    const { driver, outputs } = await connectNova75();
    expect(driver.getSettingsSchema().keyResponseTime).toHaveLength(5);
    const before = outputs().length;
    await driver.setSystemSettings({ sleepTime: 2, keyResponseTime: 3 });
    await driver.setGameMode(true);
    const [a, b] = outputs().slice(before);
    expect(a!.slice(0, 19)).toEqual([
      7, 0x10, 0, 0, 1, 1, 1, 1, 1, 2, 0, 3, 0, 0, 0, 0, 0, 0xaa, 0x55,
    ]);
    // Game mode keeps the other settings and locks Win, Alt+Tab and Alt+F4 with it.
    expect(b!.slice(8, 16)).toEqual([1, 2, 0, 3, 1, 1, 1, 1]);
    expect(await driver.getSystemSettings()).toMatchObject({
      sleepTime: 2,
      keyResponseTime: 3,
      gameMode: true,
    });
  });

  it('refuses lighting and settings writes until experimental mode is on', async () => {
    const { driver, outputs } = await connectNova75(false);
    const before = outputs().length;
    const blocked = (e: unknown) => isOpenKeyError(e) && e.code === 'SAFETY_BLOCKED';
    await expect(driver.setSystemSettings({ sleepTime: 1 })).rejects.toSatisfy(blocked);
    await expect(
      driver.setRgbConfig({
        effect: 0,
        color: { r: 0, g: 0, b: 0 },
        colorful: false,
        brightness: 0,
        speed: 0,
        direction: 'right',
      }),
    ).rejects.toSatisfy(blocked);
    expect(outputs().length).toBe(before);
  });
});

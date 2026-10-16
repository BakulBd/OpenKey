import { describe, expect, it } from 'vitest';
import { runDoctor } from '@openkey/core';
import { lookupCatalog } from '@openkey/devices';
import { MockHidDevice } from '@openkey/hid';
import type { HidCollection } from '@openkey/hid';
import { createDefaultRegistry, detectionVerdict } from '@openkey/protocols';

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

  it('never pings another brand’s receiver with the AJAZZ command, even if it has a vendor page', async () => {
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

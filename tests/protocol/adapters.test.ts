import { describe, expect, it } from 'vitest';
import { Evidence, FeatureStatus, SafetyLevel, toHex, writeDecision } from '@openkey/core';
import { MockHidDevice, replayBehavior } from '@openkey/hid';
import type { HidInterfaceInfo, MockBehavior, RecordedPacket } from '@openkey/hid';
import { buildFingerprint, createDefaultRegistry, sonixFeature } from '@openkey/protocols';
import { fixture } from '../helpers.js';

/** A behaviour that records any I/O, to prove planned adapters and descriptor detection send nothing. */
function tripwire(): MockBehavior & { touched: string[] } {
  const touched: string[] = [];
  return {
    touched,
    onOutput: () => void touched.push('output'),
    onFeatureSet: () => void touched.push('feature-set'),
    onFeatureGet: (_id, len) => {
      touched.push('feature-get');
      return new Uint8Array(len);
    },
  };
}

const iface = (
  collections: HidInterfaceInfo['collections'],
  interfaceNumber?: number,
): HidInterfaceInfo => ({
  ...(interfaceNumber !== undefined ? { interfaceNumber } : {}),
  collections,
});

describe('adapter registry', () => {
  it('every registered adapter has a manifest with provenance and separate input/config transports', () => {
    const r = createDefaultRegistry();
    for (const p of [...r.list(), ...r.planned()]) {
      expect(p.manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(p.manifest.provenance.length).toBeGreaterThan(0);
      expect(p.manifest.transports.input.length).toBeGreaterThan(0);
    }
    // Planned adapters configure nothing, on any link.
    for (const p of r.planned()) expect(p.manifest.transports.configuration).toEqual([]);
  });

  it('every adapter that claims "verified" names a tested unit backed by a hardware fixture', () => {
    for (const p of createDefaultRegistry()
      .list()
      .filter((x) => x.manifest.status === 'verified')) {
      expect(p.manifest.verifiedIdentities.length, p.id).toBeGreaterThan(0);
      for (const v of p.manifest.verifiedIdentities) expect(v.evidence, p.id).toMatch(/-hw\.json/);
    }
    const flagship = createDefaultRegistry().get('sonix-feature')!;
    expect(flagship.manifest.status).toBe('verified');
    expect(flagship.manifest.transports.configuration).toEqual(['usb']);
  });
});

describe('unknown-device mode: planned families', () => {
  it('a BY Tech-shaped board is only a candidate and receives nothing without consent', async () => {
    const trip = tripwire();
    const dev = new MockHidDevice(
      { vendorId: 0x258a, productId: 0x010c, productName: 'USB-HID Keyboard' },
      [
        {
          info: iface([
            {
              usagePage: 0x0001,
              usage: 0x0006,
              inputReports: [{ reportId: 0, size: 8 }],
              outputReports: [],
              featureReports: [],
            },
          ]),
          behavior: trip,
        },
        {
          info: iface([
            {
              usagePage: 0xff00,
              usage: 0x0001,
              inputReports: [],
              outputReports: [],
              featureReports: [{ reportId: 6, size: 519 }],
            },
          ]),
          behavior: trip,
        },
      ],
    );
    const report = await createDefaultRegistry().detect(dev.group(), { level: 'handshake' });
    expect(report.selected?.identification ?? 'descriptor').toBe('descriptor');
    expect(report.possibleFamilies.map((f) => f.id)).toContain('by-tech');
    expect(trip.touched).toEqual([]);
    expect(dev.traffic).toEqual([]);
    // With consent, an all-zero reply is not an answer: the read is rejected and nothing else is sent.
    const allowed = await createDefaultRegistry().detect(dev.group(), {
      level: 'handshake',
      consent: ['by-tech'],
    });
    expect(allowed.selected).toBeNull();
    expect(
      dev.traffic.map(
        (t) => `${t.op}:${t.op === 'feature-set' ? toHex(t.data.subarray(0, 2)) : ''}`,
      ),
    ).toEqual(['feature-set:82 01', 'feature-get:']);
  });

  it('names ROYUAN for an FFFF:0002 64-byte feature collection and sends nothing', async () => {
    const trip = tripwire();
    const dev = new MockHidDevice(
      { vendorId: 0x3151, productId: 0x4011, productName: 'Keyboard' },
      [
        {
          info: iface([
            {
              usagePage: 0xffff,
              usage: 0x0002,
              inputReports: [],
              outputReports: [],
              featureReports: [{ reportId: 0, size: 64 }],
            },
          ]),
          behavior: trip,
        },
      ],
    );
    const report = await createDefaultRegistry().detect(dev.group(), { level: 'handshake' });
    expect(report.possibleFamilies.map((f) => f.id)).toEqual(['royuan']);
    // A candidate from descriptors only: the identify read waits for consent.
    expect(report.selected?.identification ?? 'descriptor').toBe('descriptor');
    expect(trip.touched).toEqual([]);
  });

  it('a plain keyboard with no vendor collection is UNKNOWN', async () => {
    const dev = new MockHidDevice({ vendorId: 0x1234, productId: 0x5678, productName: 'Generic' }, [
      {
        info: iface([
          {
            usagePage: 0x0001,
            usage: 0x0006,
            inputReports: [{ reportId: 0, size: 8 }],
            outputReports: [],
            featureReports: [],
          },
        ]),
        behavior: tripwire(),
      },
    ]);
    const fp = buildFingerprint(
      await createDefaultRegistry().detect(dev.group(), { level: 'handshake' }),
    );
    expect(fp.confidence).toBe('UNKNOWN');
    expect(fp.adapterId).toBeNull();
  });

  it('same VID:PID with different descriptors yields different fingerprints', async () => {
    const id = { vendorId: 0x258a, productId: 0x010c, productName: 'X' };
    const a = new MockHidDevice(id, [
      {
        info: iface([
          {
            usagePage: 0xff00,
            usage: 1,
            inputReports: [],
            outputReports: [],
            featureReports: [{ reportId: 6, size: 519 }],
          },
        ]),
        behavior: {},
      },
    ]);
    const b = new MockHidDevice(id, [
      {
        info: iface([
          {
            usagePage: 0xff00,
            usage: 1,
            inputReports: [],
            outputReports: [],
            featureReports: [{ reportId: 6, size: 8 }],
          },
        ]),
        behavior: {},
      },
    ]);
    const reg = createDefaultRegistry();
    const fa = buildFingerprint(await reg.detect(a.group()));
    const fb = buildFingerprint(await reg.detect(b.group()));
    expect(fa.key).not.toBe(fb.key);
  });
});

describe('AK820 MAX PLUS fingerprint (real descriptors + hardware handshake capture)', () => {
  it('is VERIFIED and explains why', async () => {
    const fx = fixture<{ packets: RecordedPacket[] }>(
      'device-info/ak820-max-plus-start-handshake-hw.json',
    );
    const ifs = sonixFeature.sonixFeatureInterfaces();
    const dev = new MockHidDevice(
      {
        vendorId: 0x0c45,
        productId: 0x8009,
        productName: 'AK820 MAX',
        manufacturer: 'SONiX',
        release: 0x0107,
      },
      [
        { info: ifs.data, behavior: {} },
        { info: ifs.control, behavior: replayBehavior(fx.packets) },
      ],
    );
    const fp = buildFingerprint(
      await createDefaultRegistry().detect(dev.group(), { level: 'handshake' }),
    );
    expect(fp.confidence).toBe('VERIFIED');
    expect(fp.adapterId).toBe('sonix-feature');
    expect(fp.explanation.join('\n')).toMatch(/FF13:0001/);
    expect(fp.signals.find((s) => s.name === 'bcdDevice')?.value).toBe('0x0107');
  });
});

describe('AK820 capability regression (USB)', () => {
  const sim = new sonixFeature.SonixFeatureSimulator();
  const variant = sonixFeature.resolveVariant('AK820 MAX');
  const caps = sonixFeature.sonixFeatureCapabilities(variant, 'usb', 0x8009);
  const real = { simulated: false, experimentalEnabled: false };
  /** Verified on the owner's AK820 MAX PLUS (fixtures/verification/ak820-max-plus-owner-test-hw.json). */
  const VERIFIED_WRITES = [
    'keymap',
    'fnLayer',
    'macros',
    'rgb',
    'perKeyRgb',
    'tft',
    'tftGif',
    'tftClock',
    'sleep',
    'keyResponse',
    'winLock',
    'altLocks',
  ];

  it('offers exactly the hardware-verified writes in normal UI; the rest stay opt-in', () => {
    expect(sim).toBeTruthy();
    for (const [id, c] of Object.entries(caps)) {
      if (!c.write) continue;
      expect.soft(c.safety, id).toBeDefined();
      expect
        .soft(writeDecision(c, real).kind, id)
        .toBe(VERIFIED_WRITES.includes(id) ? 'allowed' : 'experimental');
    }
  });

  it('verification applies only to the tested unit and link', () => {
    const other = (pid: number, t: 'usb' | '2.4ghz', name = 'AK820 MAX') =>
      sonixFeature.sonixFeatureCapabilities(sonixFeature.resolveVariant(name), t, pid);
    for (const c of [
      other(0x800a, 'usb'),
      other(0x8009, '2.4ghz'),
      other(0x8009, 'usb', 'AK820'),
      other(0x8009, 'usb', 'Mystery Board'),
    ])
      for (const id of VERIFIED_WRITES)
        expect.soft(c[id as 'keymap'].confidence, id).not.toBe(Evidence.VERIFIED);
  });

  it('settings the firmware cannot report are WRITE_ONLY and CAUTION', () => {
    expect(caps.keymap.status).toBe(FeatureStatus.WRITE_ONLY);
    expect(caps.keymap.safety).toBe(SafetyLevel.CAUTION);
    expect(caps.perKeyRgb.status).toBe(FeatureStatus.SUPPORTED);
    expect(caps.perKeyRgb.read).toBe('device');
  });

  it('does not claim a polling rate from bInterval', () => {
    expect(caps.pollingRate.value).toMatch(/Declared interval 1 ms/);
    expect(caps.pollingRate.value).not.toMatch(/Hz/);
    expect(caps.pollingRate.confidence).toBe(Evidence.VERIFIED);
  });

  it('Bluetooth is transport-limited, not unsupported', () => {
    const bt = sonixFeature.sonixFeatureCapabilities(variant, 'bluetooth', 0x8009);
    expect(bt.keymap.status).toBe(FeatureStatus.TRANSPORT_LIMITED);
    expect(bt.tft.status).toBe(FeatureStatus.TRANSPORT_LIMITED);
  });

  it('features without evidence stay UNKNOWN', () => {
    for (const f of ['debounce', 'actuation', 'rapidTrigger', 'profiles', 'firmware'] as const)
      expect(caps[f].status).toBe(FeatureStatus.UNKNOWN);
  });
});

describe('device catalogue', () => {
  it('never resolves a VID:PID shared by different products to one model', async () => {
    const { lookupCatalog, lookupCatalogAll } = await import('@openkey/devices');
    const id = { vendorId: 0x258a, productId: 0x010c, productName: 'USB-HID Keyboard' };
    expect(
      lookupCatalogAll(id)
        .map((e) => e.brand)
        .sort(),
    ).toEqual(['AJAZZ', 'AULA']);
    expect(lookupCatalog(id)).toBeUndefined();
    expect(
      lookupCatalog({ vendorId: 0x0c45, productId: 0x8009, productName: 'AK820 MAX' })?.status,
    ).toBe('verified');
  });

  it('no catalogue entry claims "verified" without an adapter verified on that exact identity', async () => {
    const { CATALOG } = await import('@openkey/devices');
    const reg = createDefaultRegistry();
    for (const e of CATALOG.filter((x) => x.status === 'verified')) {
      const ids = reg.list().flatMap((p) => p.manifest.verifiedIdentities);
      expect(
        ids.some(
          (v) => v.vendorId === e.vendorId && v.productId === e.productId && v.transport === e.link,
        ),
        `${e.brand} ${e.model}`,
      ).toBe(true);
    }
  });
});

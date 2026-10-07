import { describe, expect, it } from 'vitest';
import { Evidence, FeatureStatus, SafetyLevel, writeDecision } from '@openkey/core';
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

const iface = (collections: HidInterfaceInfo['collections'], interfaceNumber?: number): HidInterfaceInfo => ({
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

  it('the flagship adapter is experimental until its writes are verified on hardware', () => {
    const p = createDefaultRegistry().get('sonix-feature')!;
    expect(p.manifest.status).toBe('experimental');
    expect(p.manifest.transports.configuration).toEqual(['usb']);
  });
});

describe('unknown-device mode: planned families', () => {
  it('names AULA as a possible family from descriptors only and sends nothing', async () => {
    const trip = tripwire();
    const dev = new MockHidDevice({ vendorId: 0x258a, productId: 0x010c, productName: 'USB-HID Keyboard' }, [
      { info: iface([{ usagePage: 0x0001, usage: 0x0006, inputReports: [{ reportId: 0, size: 8 }], outputReports: [], featureReports: [] }]), behavior: trip },
      { info: iface([{ usagePage: 0xff00, usage: 0x0001, inputReports: [], outputReports: [], featureReports: [{ reportId: 6, size: 519 }] }]), behavior: trip },
    ]);
    const report = await createDefaultRegistry().detect(dev.group(), { level: 'handshake' });
    expect(report.selected).toBeNull();
    expect(report.possibleFamilies.map((f) => f.id)).toContain('aula-sinowealth');
    const fp = buildFingerprint(report);
    expect(fp.confidence).toBe('LOW');
    expect(fp.explanation.join('\n')).toMatch(/not support/);
    expect(trip.touched).toEqual([]);
    expect(dev.traffic).toEqual([]);
  });

  it('names ROYUAN for an FFFF:0002 64-byte feature collection and sends nothing', async () => {
    const trip = tripwire();
    const dev = new MockHidDevice({ vendorId: 0x3151, productId: 0x4011, productName: 'Keyboard' }, [
      { info: iface([{ usagePage: 0xffff, usage: 0x0002, inputReports: [], outputReports: [], featureReports: [{ reportId: 0, size: 64 }] }]), behavior: trip },
    ]);
    const report = await createDefaultRegistry().detect(dev.group(), { level: 'handshake' });
    expect(report.possibleFamilies.map((f) => f.id)).toEqual(['royuan']);
    expect(report.selected).toBeNull();
    expect(trip.touched).toEqual([]);
  });

  it('a plain keyboard with no vendor collection is UNKNOWN', async () => {
    const dev = new MockHidDevice({ vendorId: 0x1234, productId: 0x5678, productName: 'Generic' }, [
      { info: iface([{ usagePage: 0x0001, usage: 0x0006, inputReports: [{ reportId: 0, size: 8 }], outputReports: [], featureReports: [] }]), behavior: tripwire() },
    ]);
    const fp = buildFingerprint(await createDefaultRegistry().detect(dev.group(), { level: 'handshake' }));
    expect(fp.confidence).toBe('UNKNOWN');
    expect(fp.adapterId).toBeNull();
  });

  it('same VID:PID with different descriptors yields different fingerprints', async () => {
    const id = { vendorId: 0x258a, productId: 0x010c, productName: 'X' };
    const a = new MockHidDevice(id, [{ info: iface([{ usagePage: 0xff00, usage: 1, inputReports: [], outputReports: [], featureReports: [{ reportId: 6, size: 519 }] }]), behavior: {} }]);
    const b = new MockHidDevice(id, [{ info: iface([{ usagePage: 0xff00, usage: 1, inputReports: [], outputReports: [], featureReports: [{ reportId: 6, size: 8 }] }]), behavior: {} }]);
    const reg = createDefaultRegistry();
    const fa = buildFingerprint(await reg.detect(a.group()));
    const fb = buildFingerprint(await reg.detect(b.group()));
    expect(fa.key).not.toBe(fb.key);
  });
});

describe('AK820 MAX PLUS fingerprint (real descriptors + hardware handshake capture)', () => {
  it('is VERIFIED and explains why', async () => {
    const fx = fixture<{ packets: RecordedPacket[] }>('device-info/ak820-max-plus-start-handshake-hw.json');
    const ifs = sonixFeature.sonixFeatureInterfaces();
    const dev = new MockHidDevice(
      { vendorId: 0x0c45, productId: 0x8009, productName: 'AK820 MAX', manufacturer: 'SONiX', release: 0x0107 },
      [
        { info: ifs.data, behavior: {} },
        { info: ifs.control, behavior: replayBehavior(fx.packets) },
      ],
    );
    const fp = buildFingerprint(await createDefaultRegistry().detect(dev.group(), { level: 'handshake' }));
    expect(fp.confidence).toBe('VERIFIED');
    expect(fp.adapterId).toBe('sonix-feature');
    expect(fp.explanation.join('\n')).toMatch(/FF13:0001/);
    expect(fp.signals.find((s) => s.name === 'bcdDevice')?.value).toBe('0x0107');
  });
});

describe('AK820 capability regression (USB)', () => {
  const sim = new sonixFeature.SonixFeatureSimulator();
  const variant = sonixFeature.resolveVariant('AK820 MAX');
  const caps = sonixFeature.sonixFeatureCapabilities(variant, 'usb');
  const real = { simulated: false, experimentalEnabled: false };

  it('no flagship write is offered in normal UI until verified on hardware', () => {
    expect(sim).toBeTruthy();
    for (const [id, c] of Object.entries(caps)) {
      if (!c.write) continue;
      expect.soft(writeDecision(c, real).kind, id).not.toBe('allowed');
      expect.soft(c.safety, id).toBeDefined();
    }
  });

  it('settings the firmware cannot report are WRITE_ONLY and CAUTION', () => {
    expect(caps.keymap.status).toBe(FeatureStatus.WRITE_ONLY);
    expect(caps.keymap.safety).toBe(SafetyLevel.CAUTION);
    expect(caps.perKeyRgb.status).toBe(FeatureStatus.CONFIGURABLE);
    expect(caps.perKeyRgb.read).toBe('device');
  });

  it('does not claim a polling rate from bInterval', () => {
    expect(caps.pollingRate.value).toMatch(/Declared interval 1 ms/);
    expect(caps.pollingRate.value).not.toMatch(/Hz/);
    expect(caps.pollingRate.confidence).toBe(Evidence.VERIFIED);
  });

  it('Bluetooth is transport-limited, not unsupported', () => {
    const bt = sonixFeature.sonixFeatureCapabilities(variant, 'bluetooth');
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
    expect(lookupCatalogAll(id).map((e) => e.brand).sort()).toEqual(['AJAZZ', 'AULA']);
    expect(lookupCatalog(id)).toBeUndefined();
    expect(lookupCatalog({ vendorId: 0x0c45, productId: 0x8009, productName: 'AK820 MAX' })?.status).toBe('experimental');
  });

  it('no catalogue entry claims "verified" without hardware-verified writes', async () => {
    const { CATALOG } = await import('@openkey/devices');
    expect(CATALOG.filter((e) => e.status === 'verified')).toEqual([]);
  });
});

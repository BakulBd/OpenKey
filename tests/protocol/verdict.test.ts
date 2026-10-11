import { describe, expect, it } from 'vitest';
import { Evidence } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import type { HidDeviceGroup } from '@openkey/hid';
import { ProtocolRegistry, createDefaultRegistry, detectionVerdict, formatVerdict, sonixFeature } from '@openkey/protocols';
import type { ProtocolDefinition } from '@openkey/protocols';

/** The verdict logic for physical devices, driven through a simulator relabelled as WebHID. */
const physical = (g: HidDeviceGroup, extra: Partial<HidDeviceGroup> = {}): HidDeviceGroup => ({ ...g, backend: 'webhid', ...extra });

async function verdictFor(group: HidDeviceGroup, consent: string[] = [], registry = createDefaultRegistry()) {
  const report = await registry.detect(group, { level: 'handshake', consent });
  return { report, verdict: detectionVerdict(report, registry) };
}

describe('detection verdict', () => {
  it('VERIFIED_MATCH: identified by the device and a hardware-verified identity', async () => {
    const { verdict } = await verdictFor(physical(new sonixFeature.SonixFeatureSimulator().device.group()));
    expect(verdict.kind).toBe('VERIFIED_MATCH');
    expect(verdict.writeEligible).toBe(true);
    expect(verdict.reasons[0]).toMatch(/verified on hardware/);
    expect(verdict.next).toEqual({ kind: 'configure', adapterId: 'sonix-feature' });
  });

  it('FIRMWARE_UNVERIFIED: same family, a firmware never tested', async () => {
    const sim = new sonixFeature.SonixFeatureSimulator({ vendorId: 0x0c45, productId: 0x8009, productName: 'AK820 MAX', release: 0x0108 });
    const { verdict } = await verdictFor(physical(sim.device.group()));
    expect(verdict.kind).toBe('FIRMWARE_UNVERIFIED');
    expect(verdict.conflicts.join(' ')).toMatch(/Verified on firmware 0107; this unit reports 0108/);
  });

  it('FIRMWARE_UNVERIFIED: an official identity OpenKey never tested (AK820 Pro)', async () => {
    const sim = new sonixFeature.SonixFeatureSimulator({ vendorId: 0x0c45, productId: 0x8009, productName: 'AK820' });
    const { verdict } = await verdictFor(physical(sim.device.group()));
    expect(verdict.kind).toBe('FIRMWARE_UNVERIFIED');
    expect(verdict.writeEligible).toBe(true);
  });

  it('TRANSPORT_UNSUPPORTED: the family is known, the link carries no configuration', async () => {
    const g = physical(new sonixFeature.SonixFeatureSimulator().device.group(), { transportHint: 'bluetooth' });
    const { verdict } = await verdictFor(g);
    expect(verdict.kind).toBe('TRANSPORT_UNSUPPORTED');
    expect(verdict.writeEligible).toBe(false);
    expect(verdict.next).toEqual({ kind: 'switch-transport', transports: ['usb'] });
  });

  it('STRONG_CANDIDATE: matching topology, identification waits for consent and lists what it sends', async () => {
    const sim = new sonixFeature.SonixFeatureSimulator({ vendorId: 0x1234, productId: 0x0001, productName: 'Generic Keyboard' });
    const { verdict } = await verdictFor(physical(sim.device.group()));
    expect(verdict.kind).toBe('STRONG_CANDIDATE');
    expect(verdict.writeEligible).toBe(false);
    expect(verdict.next.kind).toBe('consent-probe');
    if (verdict.next.kind === 'consent-probe')
      expect(verdict.next.operations.filter((o) => o.op === 'feature-set').map((o) => o.payloadPrefix)).toEqual(['04 18']);
    expect(formatVerdict(verdict)).toMatch(/--allow-probe sonix-feature/);
  });

  it('after consent the same device is identified but stays unverified', async () => {
    const sim = new sonixFeature.SonixFeatureSimulator({ vendorId: 0x1234, productId: 0x0001, productName: 'Generic Keyboard' });
    const { verdict } = await verdictFor(physical(sim.device.group()), ['sonix-feature']);
    expect(verdict.kind).toBe('FIRMWARE_UNVERIFIED');
  });

  it('FAMILY_CANDIDATE: an adapter without an identification command never qualifies', async () => {
    const dev = new MockHidDevice({ vendorId: 0x1a2c, productId: 0x8fff, productName: 'AK820 Max Plus' }, [
      { info: { collections: [{ usagePage: 0xff02, usage: 1, inputReports: [], outputReports: [{ reportId: 0, size: 64 }], featureReports: [] }] }, behavior: {} },
    ]);
    const { verdict } = await verdictFor(physical(dev.group()));
    expect(verdict.kind).toBe('FAMILY_CANDIDATE');
    expect(verdict.writeEligible).toBe(false);
  });

  it('INSPECT_ONLY: a catalogued identity no adapter can configure', async () => {
    const dev = new MockHidDevice({ vendorId: 0x1a2c, productId: 0x9605, productName: 'USB Keyboard' }, [
      { info: { collections: [{ usagePage: 1, usage: 6, inputReports: [{ reportId: 0, size: 8 }], outputReports: [], featureReports: [] }] }, behavior: {} },
    ]);
    const { verdict } = await verdictFor(physical(dev.group()));
    expect(verdict.kind).toBe('INSPECT_ONLY');
    expect(verdict.reasons[0]).toMatch(/single-colour/);
  });

  it('AMBIGUOUS: two adapters identify the device equally; OpenKey does not choose', async () => {
    const base = createDefaultRegistry().get('sonix-feature')!;
    const twin: ProtocolDefinition = { ...base, id: 'sonix-feature-twin', name: 'Twin' };
    // Two adapters that both "identify" the device must never be resolved by guessing; a twin that
    // also passes after the first confirmed is skipped, so make both stop at the passive level.
    const reg = new ProtocolRegistry().register({ ...base, probePlan: { ...base.probePlan, autoConsent: () => ({ auto: false, reason: 'test' }) } }).register({
      ...twin,
      probePlan: { ...twin.probePlan, autoConsent: () => ({ auto: false, reason: 'test' }) },
    });
    const sim = new sonixFeature.SonixFeatureSimulator();
    const report = await reg.detect(physical(sim.device.group()), { level: 'handshake' });
    expect(report.ambiguous).toBe(true);
    expect(detectionVerdict(report, reg).kind).toBe('AMBIGUOUS');
    expect(detectionVerdict(report, reg).writeEligible).toBe(false);
  });

  it('UNKNOWN: nothing matches, and the verdict says what was not observed', async () => {
    const dev = new MockHidDevice({ vendorId: 0x9999, productId: 0x0001, productName: '' }, [
      { info: { collections: [{ usagePage: 1, usage: 6, inputReports: [{ reportId: 0, size: 8 }], outputReports: [], featureReports: [] }] }, behavior: {} },
    ]);
    const { verdict } = await verdictFor(physical(dev.group()));
    expect(verdict.kind).toBe('UNKNOWN');
    expect(verdict.unknowns.join(' ')).toMatch(/bcdDevice/);
    expect(verdict.next).toEqual({ kind: 'contribute' });
  });

  it('a probe that passes without identifying never makes a device eligible', async () => {
    const sim = new sonixFeature.SonixFeatureSimulator({ vendorId: 0x1234, productId: 0x0001, productName: 'Generic Keyboard' });
    const { report } = await verdictFor(physical(sim.device.group()));
    const cand = report.candidates.find((c) => c.protocol.id === 'sonix-feature')!;
    expect(cand.probe?.status).toBe('pass');
    expect(cand.probe?.confidence).toBe(Evidence.OBSERVED);
    expect(cand.probe?.identified).toBeFalsy();
    expect(report.selected?.identification).toBe('passive');
  });
});

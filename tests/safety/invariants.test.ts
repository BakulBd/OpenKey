/**
 * Safety invariants (docs/SAFETY_INVARIANTS.md). Each `describe` is one rule; a failure here means
 * OpenKey could send something to a keyboard it has no evidence for.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DiagnosticFormatError,
  Evidence,
  FeatureStatus,
  SafetyLevel,
  buildSupportBundle,
  feature,
  isOpenKeyError,
  parseSupportBundle,
  runTransaction,
  writeDecision,
} from '@openkey/core';
import type { SupportBundle } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import type { MockBehavior, MockTraffic } from '@openkey/hid';
import {
  analyzeDiagnostic,
  connectKeyboard,
  createDefaultRegistry,
  detectionVerdict,
  offlineGroup,
  sonixAa55,
  sonixFeature,
} from '@openkey/protocols';
import { ROOT, noSleep } from '../helpers.js';

const diagnostic = (name: string): SupportBundle =>
  parseSupportBundle(readFileSync(path.join(ROOT, 'fixtures/diagnostics', name), 'utf8'));

const FIXTURE_A = 'unknown-a-258a-015e.json';
const FIXTURE_B = 'unknown-b-3151-6000.json';
const AK820 = 'ak820-max-plus-descriptors.json';

/** Firmware that answers reads with zeros and accepts writes, recording everything. */
const permissive: MockBehavior = {
  onOutput: () => undefined,
  onFeatureSet: () => undefined,
  onFeatureGet: (_id, len) => new Uint8Array(len),
};

/** A live mock device with the descriptors of a diagnostic fixture. */
function liveFromDiagnostic(b: SupportBundle): MockHidDevice {
  const g = offlineGroup(b.device!);
  return new MockHidDevice(g.identity, g.interfaces.map((info) => ({ info, behavior: permissive })));
}

const sent = (traffic: MockTraffic[]) => traffic.filter((t) => t.op === 'output' || t.op === 'feature-set');

const connect = (dev: MockHidDevice, consent?: string[]) =>
  connectKeyboard(dev.group(), {
    registry: createDefaultRegistry(),
    level: 'handshake',
    ...(consent ? { consent } : {}),
    cmdDelayMs: 0,
    sleep: noSleep,
  });

describe('rule 1: an unknown device receives nothing', () => {
  for (const name of [FIXTURE_A, FIXTURE_B]) {
    it(`${name}: a live connection sends no report and creates no driver`, async () => {
      const dev = liveFromDiagnostic(diagnostic(name));
      await expect(connect(dev)).rejects.toSatisfy(isOpenKeyError);
      expect(sent(dev.traffic)).toEqual([]);
    });
  }

  it('fixture A only resembles the AULA research signature: no adapter, no write path', async () => {
    const a = await analyzeDiagnostic(diagnostic(FIXTURE_A), createDefaultRegistry());
    expect(a.detection.selected).toBeNull();
    expect(a.detection.possibleFamilies.map((f) => f.id)).toEqual(['aula-sinowealth']);
    expect(a.verdict.kind).toBe('FAMILY_CANDIDATE');
    expect(a.verdict.writeEligible).toBe(false);
    expect(a.verdict.reasons.join(' ')).toMatch(/resemblance is not support/i);
    expect(a.missingUsages).toBe(2);
  });

  it('fixture B matches nothing; its vendor ID is only a weak signal', async () => {
    const a = await analyzeDiagnostic(diagnostic(FIXTURE_B), createDefaultRegistry());
    expect(a.detection.selected).toBeNull();
    expect(a.detection.candidates.filter((c) => c.match.applicable)).toEqual([]);
    expect(a.verdict.kind).toBe('UNKNOWN');
    expect(a.verdict.writeEligible).toBe(false);
    expect(a.verdict.reasons.join(' ')).toMatch(/vendor ID identifies no protocol/);
  });

  it('a numbered 31-byte vendor collection (fixture B) is not an AA/55 command pipe', () => {
    const g = offlineGroup(diagnostic(FIXTURE_B).device!);
    expect(sonixAa55.configInterface(g)).toBeUndefined();
  });
});

describe('rule 2: no probe is sent without evidence that it is harmless for this identity', () => {
  it('the AK820 topology under a foreign identity gets no START without consent', async () => {
    const sim = new sonixFeature.SonixFeatureSimulator({ vendorId: 0x1234, productId: 0x0001, productName: 'Generic Keyboard' });
    await expect(connect(sim.device)).rejects.toSatisfy(
      (e) => isOpenKeyError(e) && e.details.awaitingConsent === true,
    );
    expect(sent(sim.device.traffic)).toEqual([]);
  });

  it('with consent, exactly the declared START is sent and nothing is written', async () => {
    const sim = new sonixFeature.SonixFeatureSimulator({ vendorId: 0x1234, productId: 0x0001, productName: 'Generic Keyboard' });
    await connect(sim.device, ['sonix-feature']);
    expect(sent(sim.device.traffic).map((t) => [...t.data.subarray(0, 2)])).toEqual([[0x04, 0x18]]);
  });

  it('the hardware-verified identity is identified automatically', async () => {
    const sim = new sonixFeature.SonixFeatureSimulator();
    const kb = await connect(sim.device);
    expect(kb.detection.selected?.identification).toBe('identified');
  });

  it('an online-driver identity gets GET_DEVICE_INFO; the same pipe under another identity does not', async () => {
    const listed = new sonixAa55.SonixAa55Simulator();
    await connect(listed.device);
    expect(sent(listed.device.traffic).length).toBeGreaterThan(0);

    const other = new sonixAa55.SonixAa55Simulator({ vendorId: 0x1234, productId: 0x0002, productName: 'Some Mouse' });
    await expect(connect(other.device)).rejects.toSatisfy(isOpenKeyError);
    expect(sent(other.device.traffic)).toEqual([]);
  });
});

describe('rule 3: descriptor similarity never creates a driver', () => {
  it('the CRS family has no identification command, so it is never configurable', async () => {
    const dev = new MockHidDevice({ vendorId: 0x1a2c, productId: 0x8fff, productName: 'AK820 Max Plus' }, [
      { info: { collections: [{ usagePage: 0xff02, usage: 1, inputReports: [], outputReports: [{ reportId: 0, size: 64 }], featureReports: [] }] }, behavior: permissive },
    ]);
    await expect(connect(dev, ['crs-aa55cc33'])).rejects.toSatisfy(
      (e) => isOpenKeyError(e) && e.details.unconfirmed === true,
    );
    expect(sent(dev.traffic)).toEqual([]);
  });

  it('offline analysis of the real AK820 descriptors is a candidate, never write-eligible', async () => {
    const a = await analyzeDiagnostic(diagnostic(AK820), createDefaultRegistry());
    expect(a.verdict.kind).toBe('STRONG_CANDIDATE');
    expect(a.verdict.adapterId).toBe('sonix-feature');
    expect(a.verdict.writeEligible).toBe(false);
    expect(a.verdict.next.kind).toBe('connect-device');
    // FFFF:0001 on interface 1 must not be mistaken for the ROYUAN settings channel.
    expect(a.detection.possibleFamilies.map((f) => f.id)).not.toContain('royuan');
  });

  it('an offline device can never open a transport', async () => {
    const g = offlineGroup(diagnostic(AK820).device!);
    await expect(g.openInterface(g.interfaces[3]!)).rejects.toThrow(/Offline/);
  });
});

describe('rule 4: the write policy', () => {
  const ctx = { simulated: false, experimentalEnabled: true };
  it('never allows firmware-class operations, even on a simulator', () => {
    const unsafe = feature(FeatureStatus.CONFIGURABLE, { write: true, read: 'device', confidence: Evidence.VERIFIED, safety: SafetyLevel.UNSAFE });
    expect(writeDecision(unsafe, ctx).kind).toBe('blocked');
    expect(writeDecision(unsafe, { simulated: true, experimentalEnabled: true }).kind).toBe('blocked');
  });

  it('never sends a write without evidence, even with the experimental opt-in', () => {
    for (const confidence of [Evidence.HYPOTHESIS, Evidence.UNKNOWN]) {
      const s = feature(FeatureStatus.CONFIGURABLE, { write: true, read: 'device', confidence, safety: SafetyLevel.SAFE_PERSISTENT });
      expect(writeDecision(s, ctx).kind).toBe('blocked');
    }
  });

  it('no adapter capability offers an unsafe or evidence-free write', async () => {
    for (const sim of [new sonixFeature.SonixFeatureSimulator().device, new sonixAa55.SonixAa55Simulator().device]) {
      const kb = await connect(sim);
      const caps = Object.entries(kb.driver.getCapabilities()).filter(([, c]) => c.write);
      expect(caps.length).toBeGreaterThan(0);
      for (const [f, c] of caps) {
        expect(c.safety, f).not.toBe(SafetyLevel.UNSAFE);
        expect([Evidence.HYPOTHESIS, Evidence.UNKNOWN], f).not.toContain(c.confidence);
      }
    }
  });
});

describe('rule 5: a failed or mismatching read-back never triggers another write', () => {
  for (const [label, readback] of [
    ['throws', () => Promise.reject(new Error('gone'))],
    ['differs', () => Promise.resolve(2)],
  ] as const) {
    it(`read-back ${label}: the write is sent exactly once`, async () => {
      let writes = 0;
      const r = await runTransaction({ label: 'x', acknowledged: true, apply: async () => void writes++, readbackFromDevice: readback }, 0, 1);
      expect(writes).toBe(1);
      expect(['FAILED', 'MISMATCH']).toContain(r.outcome);
    });
  }
});

describe('rule 6: simulations never pass for hardware', () => {
  it('a simulator is SIMULATED, never VERIFIED_MATCH', async () => {
    const reg = createDefaultRegistry();
    const kb = await connect(new sonixFeature.SonixFeatureSimulator().device);
    expect(detectionVerdict(kb.detection, reg).kind).toBe('SIMULATED');
  });
});

describe('rule 7: diagnostics stay sanitized', () => {
  it('exports drop the serial number unless the user opts in', () => {
    const b = buildSupportBundle({
      environment: { appVersion: 't', userAgent: '', platform: '', webHid: true, secureContext: true },
      device: { vendorId: '0x0001', productId: '0x0002', productName: 'K', serialNumber: 'SN-123', interfaces: [] },
      connectionState: 'READY',
    });
    expect(JSON.stringify(b)).not.toContain('SN-123');
  });

  it('imports never carry a serial number, and refuse oversized or foreign files', () => {
    const b = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/diagnostics', FIXTURE_B), 'utf8'));
    b.device.serialNumber = 'SN-999';
    expect(JSON.stringify(parseSupportBundle(JSON.stringify(b)))).not.toContain('SN-999');
    expect(() => parseSupportBundle('x'.repeat(600_000))).toThrow(DiagnosticFormatError);
    expect(() => parseSupportBundle('{"format":"something-else"}')).toThrow(DiagnosticFormatError);
  });

  it('reads the v1 display format', () => {
    const v1 = {
      format: 'openkey-support-bundle',
      version: 1,
      device: { vendorId: '0x258A', productId: '0x015E', productName: 'Gaming Keyboard', interfaces: [{ collections: [{ usagePage: '0xFF00', usage: '0x0001', inputReports: ['id 3: 3 B'], outputReports: [], featureReports: ['id 6: 519 B'] }] }] },
    };
    const b = parseSupportBundle(JSON.stringify(v1));
    expect(b.version).toBe(2);
    expect(b.device!.interfaces[0]!.collections[0]!.featureReports).toEqual([{ reportId: 6, size: 519 }]);
  });
});

describe('rule 8: every front end gets the same write policy', () => {
  it('a guarded driver refuses unverified writes without the opt-in, before any packet is sent', async () => {
    const { guardWrites } = await import('@openkey/core');
    const sim = new sonixFeature.SonixFeatureSimulator();
    const kb = await connect(sim.device);
    let experimental = false;
    const d = guardWrites(kb.driver, () => ({ simulated: false, experimentalEnabled: experimental }));
    const before = sent(sim.device.traffic).length;
    await expect(d.setPerKeyRgb({ 1: { r: 1, g: 2, b: 3 } })).rejects.toSatisfy(
      (e) => isOpenKeyError(e) && e.code === 'SAFETY_BLOCKED' && /experimental/.test(e.message),
    );
    await expect(d.syncClock(new Date())).rejects.toSatisfy((e) => isOpenKeyError(e) && e.code === 'SAFETY_BLOCKED');
    expect(sent(sim.device.traffic).length).toBe(before);
    // Reads are untouched; the opt-in applies immediately because it is read at call time.
    await expect(d.getPerKeyRgb()).resolves.toBeDefined();
    experimental = true;
    await d.setPerKeyRgb({ 1: { r: 1, g: 2, b: 3 } });
    expect(sent(sim.device.traffic).length).toBeGreaterThan(before);
  });

  it('features with no write are blocked even with the opt-in', async () => {
    const { guardWrites } = await import('@openkey/core');
    const kb = await connect(new sonixFeature.SonixFeatureSimulator().device);
    const d = guardWrites(kb.driver, () => ({ simulated: false, experimentalEnabled: true }));
    await expect(d.setGameMode(true)).rejects.toSatisfy((e) => isOpenKeyError(e) && e.code === 'SAFETY_BLOCKED');
  });
});

describe('diagnostic comparison and issue notes', () => {
  it('compares two packages by descriptor signature, independent of interface order', async () => {
    const { compareDiagnostics } = await import('@openkey/core');
    const a = diagnostic(FIXTURE_A).device!;
    const b = diagnostic(FIXTURE_B).device!;
    expect(compareDiagnostics(a, a).sameDescriptors).toBe(true);
    const d = compareDiagnostics(a, b);
    expect(d.sameDescriptors).toBe(false);
    expect(d.identity.find((x) => x.field === 'VID')).toMatchObject({ a: '0x258A', b: '0x3151', same: false });
    expect(d.collections.filter((c) => c.side === 'a')).toHaveLength(2);
    expect(d.collections.filter((c) => c.side === 'b')).toHaveLength(1);
  });

  it('issue text includes research notes only when they are passed', async () => {
    const { supportBundleToIssue } = await import('@openkey/core');
    const b = diagnostic(FIXTURE_A);
    expect(supportBundleToIssue(b)).not.toMatch(/Research notes/);
    const withNotes = supportBundleToIssue(b, [{ text: 'Fn+F1 changes report 3', evidence: 'hardware', at: '2026-10-11' }]);
    expect(withNotes).toMatch(/\(observed on hardware\) Fn\+F1 changes report 3/);
  });
});

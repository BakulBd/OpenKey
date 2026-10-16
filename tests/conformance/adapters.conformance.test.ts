/**
 * Every adapter in the default registry against the conformance kit (packages/protocols/src/
 * conformance.ts). A new adapter gets these checks by adding a sample device below.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSupportBundle } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import type { HidDeviceGroup } from '@openkey/hid';
import {
  ProtocolRegistry,
  checkManifest,
  checkMatchPurity,
  checkProbeTraffic,
  createDefaultRegistry,
  offlineGroup,
  sonixAa55,
  sonixFeature,
  byTech,
  royuan,
  aulaReceiver,
  hmk,
} from '@openkey/protocols';
import { ROOT } from '../helpers.js';

const rawHid = (page: number, usage: number, size: number) => ({
  usagePage: page,
  usage,
  inputReports: [{ reportId: 0, size }],
  outputReports: [{ reportId: 0, size }],
  featureReports: [],
});

/** A device each adapter is expected to identify, answering exactly like the documented firmware. */
const SAMPLES: Record<string, () => MockHidDevice> = {
  'sonix-feature': () => new sonixFeature.SonixFeatureSimulator().device,
  'by-tech': () => new byTech.ByTechSimulator().device,
  royuan: () => new royuan.RoyuanSimulator().device,
  'aula-receiver': () => new aulaReceiver.AulaReceiverSimulator().device,
  hmk: () => new hmk.HmkSimulator().device,
  'rk-classic': () =>
    new MockHidDevice({ vendorId: 0x258a, productId: 0x004a, productName: 'RK61RGB Wired' }, [
      {
        info: {
          collections: [
            {
              usagePage: 0x0001,
              usage: 0x0080,
              inputReports: [],
              outputReports: [],
              featureReports: [{ reportId: 0x0a, size: 64 }],
            },
          ],
        },
        behavior: { onFeatureSet: () => undefined },
      },
    ]),
  'sonix-aa55': () => new sonixAa55.SonixAa55Simulator().device,
  'qmk-via': () =>
    new MockHidDevice({ vendorId: 0xfeed, productId: 0x0001, productName: 'QMK board' }, [
      {
        info: { collections: [rawHid(0xff60, 0x61, 32)] },
        behavior: {
          onOutput: (_id, d, ctx) => {
            const r = new Uint8Array(32);
            r.set([d[0]!, 0x00, 0x0c]);
            ctx.emitInput(r);
          },
        },
      },
    ]),
  'sonix-dongle': () =>
    new MockHidDevice(
      { vendorId: 0x0c45, productId: 0xfdfd, productName: '2.4G Dongle' },
      [
        {
          info: { collections: [rawHid(0xff60, 0x61, 32)] },
          behavior: {
            onOutput: (_id, d, ctx) => {
              const r = new Uint8Array(32);
              r.set([d[0]!, d[1]!, 0x01, 87]);
              ctx.emitInput(r);
            },
          },
        },
      ],
      '2.4ghz',
    ),
  'crs-aa55cc33': () =>
    new MockHidDevice({ vendorId: 0x1a2c, productId: 0x8fff, productName: 'AK820 Max Plus' }, [
      {
        info: { collections: [{ ...rawHid(0xff02, 1, 64), inputReports: [] }] },
        behavior: { onOutput: () => undefined },
      },
    ]),
};

/** Descriptor sets every matcher must handle purely: all diagnostic fixtures and all samples. */
function corpus(): HidDeviceGroup[] {
  const dir = path.join(ROOT, 'fixtures/diagnostics');
  const fixtures = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => offlineGroup(parseSupportBundle(readFileSync(path.join(dir, f), 'utf8')).device!));
  return [...fixtures, ...Object.values(SAMPLES).map((s) => s().group())];
}

const registry = createDefaultRegistry();

describe('adapter conformance', () => {
  it('every adapter has a sample device', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(
      registry
        .list()
        .map((p) => p.id)
        .sort(),
    );
  });

  for (const def of [...registry.list(), ...registry.planned()]) {
    it(`${def.id}: manifest and probe plan`, () => {
      expect(checkManifest(def)).toEqual([]);
    });
  }

  for (const def of registry.list()) {
    it(`${def.id}: match() is pure on every known descriptor set`, () => {
      for (const g of corpus()) expect(checkMatchPurity(def, g)).toEqual([]);
    });

    it(`${def.id}: identifies its sample and sends only declared operations`, async () => {
      const dev = SAMPLES[def.id]!();
      const solo = new ProtocolRegistry().register(def);
      const report = await solo.detect(dev.group(), { level: 'handshake', consent: [def.id] });
      expect(checkProbeTraffic(def, dev.traffic, 'handshake')).toEqual([]);
      const handshake = def.probePlan.operations.some((o) => o.level === 'handshake');
      // Write-only protocols identified from the vendor's model list send nothing and still identify.
      const listed = def.probePlan.identifiedBy === 'vendor-model-list';
      expect(report.candidates[0]!.probe?.identified ?? false).toBe(handshake || listed);
      if (listed) expect(dev.traffic).toEqual([]);
    });

    it(`${def.id}: the passive level sends nothing`, async () => {
      const dev = SAMPLES[def.id]!();
      await new ProtocolRegistry().register(def).detect(dev.group(), { level: 'passive' });
      expect(dev.traffic.filter((t) => t.op !== 'feature-get')).toEqual([]);
      expect(checkProbeTraffic(def, dev.traffic, 'passive')).toEqual([]);
    });

    it(`${def.id}: never auto-probes an unrelated identity`, () => {
      if (def.id === 'qmk-via') return; // public-specification read on a reserved collection
      const foreign = {
        ...SAMPLES[def.id]!().group(),
        identity: { vendorId: 0x1234, productId: 0x5678, productName: 'Unrelated' },
      };
      expect(def.probePlan.autoConsent(foreign).auto).toBe(false);
    });
  }

  it('flags undeclared probe packets (the check is not vacuous)', () => {
    const def = registry.get('sonix-feature')!;
    const save = new Uint8Array(64);
    save.set([0x04, 0x02]);
    const start = new Uint8Array(64);
    start.set([0x04, 0x18]);
    expect(
      checkProbeTraffic(def, [{ op: 'feature-set', reportId: 0, data: save }], 'handshake'),
    ).toHaveLength(1);
    expect(
      checkProbeTraffic(def, [{ op: 'feature-set', reportId: 0, data: start }], 'passive'),
    ).toHaveLength(1);
    expect(
      checkProbeTraffic(def, [{ op: 'feature-set', reportId: 0, data: start }], 'handshake'),
    ).toEqual([]);
  });

  it('the registry refuses adapters written against another contract version', () => {
    const def = registry.get('qmk-via')!;
    expect(() => new ProtocolRegistry().register({ ...def, apiVersion: 99 })).toThrow(
      /contract v99/,
    );
    expect(() => new ProtocolRegistry().register({ ...def, id: 'Bad_Id' })).toThrow(/kebab-case/);
  });
});

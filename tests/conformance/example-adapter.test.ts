/**
 * The template adapter end to end: what every new adapter's test file should cover.
 * Copy and adapt it together with packages/protocols/src/families/example/.
 */
import { describe, expect, it } from 'vitest';
import { runTransaction } from '@openkey/core';
import type { KeymapState } from '@openkey/core';
import {
  ProtocolRegistry,
  checkManifest,
  checkMatchPurity,
  checkProbeTraffic,
  connectKeyboard,
  createDefaultRegistry,
  detectionVerdict,
  example,
} from '@openkey/protocols';

const registry = () => new ProtocolRegistry().register(example.exampleProtocol);

describe('example adapter (template)', () => {
  it('is never part of the default registry', () => {
    expect(createDefaultRegistry().get('example-echo')).toBeUndefined();
  });

  it('passes the conformance kit', async () => {
    const sim = new example.ExampleSimulator();
    expect(checkManifest(example.exampleProtocol)).toEqual([]);
    expect(checkMatchPurity(example.exampleProtocol, sim.device.group())).toEqual([]);
    await registry().detect(sim.device.group(), { level: 'handshake' });
    expect(checkProbeTraffic(example.exampleProtocol, sim.device.traffic, 'handshake')).toEqual([]);
  });

  it('identifies its device, and nothing else gets a packet', async () => {
    const ok = await registry().detect(new example.ExampleSimulator().device.group(), {
      level: 'handshake',
    });
    expect(ok.selected?.identification).toBe('identified');
    const other = new example.ExampleSimulator({
      vendorId: 0x1234,
      productId: 0x0001,
      productName: 'Other',
    });
    await registry().detect(other.device.group(), { level: 'handshake' });
    expect(other.device.traffic).toEqual([]);
  });

  it('writes a key and proves it by reading it back from the device', async () => {
    const sim = new example.ExampleSimulator();
    const { driver, detection } = await connectKeyboard(sim.device.group(), {
      registry: registry(),
    });
    expect(detectionVerdict(detection, registry()).kind).toBe('SIMULATED');
    const before = await driver.getKeymap();
    const next: KeymapState = {
      ...before,
      slots: { ...before.slots, 2: { kind: 'keyboard', usage: 0x29, modifiers: 0 } },
    };
    const result = await runTransaction(
      {
        label: 'keymap',
        acknowledged: true,
        apply: (k) => driver.setKeymap(k),
        readbackFromDevice: () => driver.getKeymap(),
      },
      before,
      next,
    );
    expect(result.outcome).toBe('VERIFIED');
    expect(sim.keys[2]).toEqual([0x29, 0]);
  });

  it('refuses what the wire format cannot express, before sending anything', async () => {
    const sim = new example.ExampleSimulator();
    const { driver } = await connectKeyboard(sim.device.group(), { registry: registry() });
    const sentBefore = sim.device.traffic.length;
    await expect(
      driver.setKeymap({ layer: 'base', provenance: 'mirror', slots: { 9: { kind: 'disabled' } } }),
    ).rejects.toThrow(/slot 9/);
    expect(sim.device.traffic.length).toBe(sentBefore);
  });

  it('reports a silent device as a timeout, not as data', async () => {
    const sim = new example.ExampleSimulator();
    const { driver } = await connectKeyboard(sim.device.group(), { registry: registry() });
    sim.device.inject({ kind: 'timeout', op: 'input' });
    await expect(driver.getKeymap()).rejects.toThrow(/no answer/);
  });
});

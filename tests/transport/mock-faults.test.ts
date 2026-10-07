import { describe, expect, it } from 'vitest';
import { MemoryStateStore, isOpenKeyError } from '@openkey/core';
import { mockCorruptions } from '@openkey/hid';
import { connectKeyboard, createDefaultRegistry, sonixFeature } from '@openkey/protocols';
import { noSleep } from '../helpers.js';

async function setup() {
  const sim = new sonixFeature.SonixFeatureSimulator();
  const kb = await connectKeyboard(sim.device.group(), {
    registry: createDefaultRegistry(),
    level: 'handshake',
    store: new MemoryStateStore(),
    cmdDelayMs: 0,
    sleep: noSleep,
    allowExperimental: true,
  });
  return { sim, ...kb };
}

const errorCode = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return isOpenKeyError(e) ? e.code : `non-OpenKey: ${String(e)}`;
  }
};

/** The flagship adapter must surface broken firmware answers as typed errors, never as success. */
describe('AK820 adapter under injected HID faults', () => {
  it('a timeout on the acknowledgement read is a TIMEOUT error', async () => {
    const { sim, driver } = await setup();
    sim.device.inject({ kind: 'timeout', op: 'feature-get' });
    expect(await errorCode(driver.syncClock(new Date(2026, 9, 8)))).toBe('TIMEOUT');
  });

  it('an all-zero acknowledgement (no echo) is a PROTOCOL error', async () => {
    const { sim, driver } = await setup();
    sim.device.inject({ kind: 'corrupt', op: 'feature-get', mutate: mockCorruptions.zeros() });
    expect(await errorCode(driver.syncClock(new Date(2026, 9, 8)))).toMatch(/PROTOCOL|MALFORMED_RESPONSE/);
  });

  it('a truncated acknowledgement is rejected', async () => {
    const { sim, driver } = await setup();
    sim.device.inject({ kind: 'corrupt', op: 'feature-get', mutate: mockCorruptions.truncate(3) });
    expect(await errorCode(driver.syncClock(new Date(2026, 9, 8)))).toMatch(/PROTOCOL|MALFORMED_RESPONSE/);
  });

  it('an acknowledgement shifted by a stray report-ID byte is rejected', async () => {
    const { sim, driver } = await setup();
    sim.device.inject({ kind: 'corrupt', op: 'feature-get', mutate: mockCorruptions.prependByte(0x06) });
    expect(await errorCode(driver.syncClock(new Date(2026, 9, 8)))).toMatch(/PROTOCOL|MALFORMED_RESPONSE/);
  });

  it('a corrupted per-key read surfaces as an error or differs, never as silent success', async () => {
    const { sim, driver } = await setup();
    const before = await driver.getPerKeyRgb();
    // Corrupt the acknowledgement of the F5 read: the command byte is flipped.
    sim.device.inject({ kind: 'corrupt', op: 'feature-get', mutate: mockCorruptions.flipByte(1) });
    expect(await errorCode(driver.getPerKeyRgb())).toMatch(/PROTOCOL|MALFORMED_RESPONSE/);
    expect(await driver.getPerKeyRgb()).toEqual(before);
  });

  it('a disconnect fails every operation with TRANSPORT until reconnected', async () => {
    const { sim, driver } = await setup();
    let notified = false;
    sim.device.onDisconnect(() => (notified = true));
    sim.device.inject({ kind: 'disconnect' });
    expect(notified).toBe(true);
    expect(await errorCode(driver.getPerKeyRgb())).toBe('TRANSPORT');
    sim.device.reconnect();
    // Handles are stale after a disconnect: a fresh connection is required.
    const again = await connectKeyboard(sim.device.group(), {
      registry: createDefaultRegistry(),
      level: 'handshake',
      store: new MemoryStateStore(),
      cmdDelayMs: 0,
      sleep: noSleep,
    });
    expect(again.detection.selected?.protocolId).toBe('sonix-feature');
  });

  it('detection after a device reset still confirms the protocol', async () => {
    const { sim } = await setup();
    sim.device.inject({ kind: 'reset' });
    const again = await connectKeyboard(sim.device.group(), {
      registry: createDefaultRegistry(),
      level: 'handshake',
      store: new MemoryStateStore(),
      cmdDelayMs: 0,
      sleep: noSleep,
    });
    expect(again.detection.selected?.protocolId).toBe('sonix-feature');
  });

  it('a dropped input report reads as silence, not as data', async () => {
    const { sim } = await setup();
    const t = await sim.device.group().openInterface(sim.device.specs[0]!.info);
    sim.device.transportFor(sim.device.specs[0]!.info.collections[0]!.usagePage)!.queue.push(new Uint8Array([1, 2, 3]));
    sim.device.inject({ kind: 'timeout', op: 'input' });
    expect(await t.readInputReport(5)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog, writeDecision } from '@openkey/core';
import { aulaReceiver, createDefaultRegistry, openDriver } from '@openkey/protocols';

const { RkM87ReceiverSimulator, m87Packet, m87Reply, M87Cmd } = aulaReceiver;

async function connect(sim = new RkM87ReceiverSimulator()) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const before = sim.sent.length;
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
  });
  return { sim, detection, detectionTraffic: before, driver: kb.driver };
}

describe('RK M87 receiver (258A:0150)', () => {
  it('builds the documented packets (rk-m87-sync: 13 0B 01 00 0E … sum)', () => {
    const payload = Uint8Array.of(0x41, 0, 0, 0xea, 0x07, 3, 10, 14, 30, 45, 2, 0, 0, 0);
    const p = m87Packet(M87Cmd.SET_SCREEN_PARAM, payload);
    expect(p).toHaveLength(19);
    expect([...p.subarray(0, 4)]).toEqual([0x0b, 0x01, 0x00, 0x0e]);
    expect([...p.subarray(4, 18)]).toEqual([...payload]);
    expect(p[18]).toBe([0x13, ...p.subarray(0, 18)].reduce((a, b) => a + b, 0) & 0xff);
    expect([...m87Packet(M87Cmd.DONGLE_STATUS).subarray(0, 4)]).toEqual([0x07, 1, 0, 0]);
  });

  it('refuses every command but the status read and the clock', () => {
    for (const cmd of [
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x09, 0x0c, 0x0d, 0x0e, 0x0f, 0x12, 0x88,
    ])
      expect(() => m87Packet(cmd)).toThrow(/never sends/);
  });

  it('reads replies as the source does, with the error bit', () => {
    const r = new Uint8Array(19);
    r[0] = 0x0b;
    expect(m87Reply(r, 0x0b)).toBe('ok');
    r[0] = 0x8b;
    expect(m87Reply(r, 0x0b)).toBe('error');
    expect(m87Reply(r.slice(0, 5), 0x0b)).toBeNull();
  });

  it('is identified without a packet, and the AULA receiver adapter does not claim it', async () => {
    const { detection, detectionTraffic, sim, driver } = await connect();
    expect(detection.selected).toMatchObject({
      protocolId: 'rk-m87-receiver',
      identification: 'identified',
    });
    expect(detectionTraffic).toBe(0);
    const aula = detection.candidates.find((c) => c.protocol.id === 'aula-receiver');
    expect(aula?.match.applicable).toBe(false);
    // On connection: only the status read.
    expect(sim.sent.map((p) => p[0])).toEqual([0x07]);
    const info = await driver.getDeviceInfo();
    expect(info.fields).toContainEqual(expect.objectContaining({ value: 'awake and linked' }));
  });

  it('sets the screen clock through the receiver, experimental', async () => {
    const { sim, driver } = await connect();
    const c = driver.getCapabilities().tftClock;
    expect(c.write).toBe(true);
    expect(writeDecision(c, { simulated: false, experimentalEnabled: false }).kind).toBe(
      'experimental',
    );
    await driver.syncClock(new Date(2026, 9, 24, 13, 5, 9));
    const p = sim.sent.at(-1)!;
    expect([...p.subarray(0, 4)]).toEqual([0x0b, 1, 0, 0x0e]);
    expect([...p.subarray(4, 15)]).toEqual([0, 0, 0, 0xea, 0x07, 10, 24, 13, 5, 9, 6]);
    expect(sim.sent.every((s) => s[0] === 0x07 || s[0] === 0x0b)).toBe(true);
  });

  it('says to wake the keyboard when it sleeps, and sends no clock then', async () => {
    const sim = new RkM87ReceiverSimulator();
    sim.awake = false;
    const { driver } = await connect(sim);
    await expect(driver.syncClock()).rejects.toThrow(/asleep/);
    expect(sim.sent.some((p) => p[0] === 0x0b)).toBe(false);
  });
});

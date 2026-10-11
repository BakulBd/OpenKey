import { describe, expect, it } from 'vitest';
import { Evidence, MemoryStateStore, PacketLog, writeDecision } from '@openkey/core';
import { createDefaultRegistry, openDriver, royuan } from '@openkey/protocols';
import { noSleep } from '../helpers.js';

const { RoyuanSimulator, packet, isAnswer, speedToWire, speedFromWire } = royuan;

async function connect(sim: InstanceType<typeof RoyuanSimulator>) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake', consent: ['royuan'] });
  const kb = await openDriver(group, detection, { registry, log: new PacketLog(), store: new MemoryStateStore(), cmdDelayMs: 0, sleep: noSleep });
  return { driver: kb.driver as InstanceType<typeof royuan.RoyuanDriver>, detection };
}

describe('ROYUAN packets', () => {
  it('puts the Bit7 and Bit8 checksums where the firmware checks them', () => {
    expect(packet([0x8f])[7]).toBe(0xff - 0x8f);
    const p = packet([0x07, 1, 2, 3, 0x07, 10, 20, 30], 'bit8');
    expect(p[8]).toBe(0xff - ((0x07 + 1 + 2 + 3 + 0x07 + 10 + 20 + 30) & 0xff));
  });

  it('refuses reset, erase and boot opcodes', () => {
    for (const op of royuan.FORBIDDEN) expect(() => packet([op])).toThrow(/never sends/);
  });

  it('does not take an echo of the request as an answer', () => {
    const req = packet([0x8f]);
    expect(isAnswer(req.slice(), req)).toBe(false);
    const r = req.slice();
    r[1] = 5;
    expect(isAnswer(r, req)).toBe(true);
  });

  it('maps speed per command set', () => {
    expect([0, 4].map((h) => speedToWire(h, 'yc500'))).toEqual([5, 1]);
    expect([0, 4].map((h) => speedToWire(h, 'gen2'))).toEqual([4, 0]);
    expect(speedFromWire(speedToWire(2, 'yc500'), 'yc500')).toBe(2);
  });
});

describe('ROYUAN driver (simulator)', () => {
  it('asks before identifying and sends nothing until allowed', async () => {
    const sim = new RoyuanSimulator();
    const r = await createDefaultRegistry().detect(sim.device.group(), { level: 'handshake' });
    expect(r.candidates.find((c) => c.protocol.id === 'royuan')!.consent).toMatchObject({ required: true });
    expect(sim.sent).toEqual([]);
  });

  it.each(['yc500', 'gen2'] as const)('identifies a %s board, reads and writes lighting with read-back', async (family) => {
    const sim = new RoyuanSimulator(family, 3056);
    const { driver, detection } = await connect(sim);
    expect(detection.selected).toMatchObject({ protocolId: 'royuan', identification: 'identified' });
    expect(driver.deviceId).toBe(3056);
    expect(driver.family).toBe(family);
    const cfg = await driver.getRgbConfig();
    expect(cfg.effect).toBe(4);
    await driver.setRgbConfig({ ...cfg, effect: 2, brightness: 3, speed: 4, colorful: true, color: { r: 255, g: 255, b: 255 } });
    expect(sim.led).toEqual([2, speedToWire(4, family), 3, 0x08, 0xfa, 0xfa, 0xfa]);
    expect(sim.sent.every((op) => [0x8f, 0x80, 0x87, 0x07].includes(op))).toBe(true);
  });

  it('never sends a mode outside the safe list', async () => {
    const { driver } = await connect(new RoyuanSimulator());
    const cfg = await driver.getRgbConfig();
    await expect(driver.setRgbConfig({ ...cfg, effect: 13 })).rejects.toThrow(/not offered/);
    await expect(driver.setRgbConfig({ ...cfg, effect: 32 })).rejects.toThrow(/not offered/);
  });

  it('keeps lighting writes experimental and everything family-specific unimplemented', async () => {
    const { driver } = await connect(new RoyuanSimulator());
    const c = driver.getCapabilities();
    expect(c.rgb.confidence).toBe(Evidence.INFERRED);
    expect(writeDecision(c.rgb, { simulated: false, experimentalEnabled: false }).kind).toBe('experimental');
    expect(c.keymap.write).toBe(false);
  });
});

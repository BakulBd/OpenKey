import { describe, expect, it } from 'vitest';
import { Evidence, MemoryStateStore, PacketLog, writeDecision } from '@openkey/core';
import { createDefaultRegistry, openDriver, royuan } from '@openkey/protocols';
import { noSleep } from '../helpers.js';

const { RoyuanSimulator, packet, isAnswer, speedToWire, speedFromWire } = royuan;

async function connect(sim: InstanceType<typeof RoyuanSimulator>) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake', consent: ['royuan'] });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
    cmdDelayMs: 0,
    sleep: noSleep,
  });
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
    expect(r.candidates.find((c) => c.protocol.id === 'royuan')!.consent).toMatchObject({
      required: true,
    });
    expect(sim.sent).toEqual([]);
  });

  it.each(['yc500', 'gen2'] as const)(
    'identifies a %s board, reads and writes lighting with read-back',
    async (family) => {
      const sim = new RoyuanSimulator(family, 3056);
      const { driver, detection } = await connect(sim);
      expect(detection.selected).toMatchObject({
        protocolId: 'royuan',
        identification: 'identified',
      });
      expect(driver.deviceId).toBe(3056);
      expect(driver.family).toBe(family);
      const cfg = await driver.getRgbConfig();
      expect(cfg.effect).toBe(4);
      await driver.setRgbConfig({
        ...cfg,
        effect: 2,
        brightness: 3,
        speed: 4,
        colorful: true,
        color: { r: 255, g: 255, b: 255 },
      });
      expect(sim.led).toEqual([2, speedToWire(4, family), 3, 0x08, 0xfa, 0xfa, 0xfa]);
      expect(
        sim.sent.every((op) => [0x8f, 0x80, 0x84, 0x85, 0x87, 0x07, 0x89, 0x8a].includes(op)),
      ).toBe(true);
    },
  );

  it('never sends a mode outside the safe list', async () => {
    const { driver } = await connect(new RoyuanSimulator());
    const cfg = await driver.getRgbConfig();
    await expect(driver.setRgbConfig({ ...cfg, effect: 13 })).rejects.toThrow(/not offered/);
    await expect(driver.setRgbConfig({ ...cfg, effect: 32 })).rejects.toThrow(/not offered/);
  });

  it('keeps lighting and key-map writes experimental and macros unimplemented', async () => {
    const { driver } = await connect(new RoyuanSimulator());
    const c = driver.getCapabilities();
    expect(c.rgb.confidence).toBe(Evidence.INFERRED);
    expect(writeDecision(c.rgb, { simulated: false, experimentalEnabled: false }).kind).toBe(
      'experimental',
    );
    expect(writeDecision(c.keymap, { simulated: false, experimentalEnabled: false }).kind).toBe(
      'experimental',
    );
    expect(c.macros.write).toBe(false);
  });
});

describe('ROYUAN key maps (simulator)', () => {
  it('labels slots by what the base layer types and reads both layers on yc500', async () => {
    const { driver } = await connect(new RoyuanSimulator('yc500'));
    expect(driver.profile).toBe(1);
    const layout = driver.getLayout();
    expect(layout.keys).toHaveLength(31);
    expect(layout.keys[0]).toMatchObject({ slot: 0, label: 'A' });
    const base = await driver.getKeymap('base');
    expect(base.slots[30]).toEqual({ kind: 'consumer', usage: 0xe9 });
    expect((await driver.getKeymap('fn')).slots[0]).toEqual({ kind: 'default' });
    expect(driver.getLayerIds()).toEqual(['base', 'fn']);
  });

  it('writes only the changed key on yc500 and reads it back', async () => {
    const sim = new RoyuanSimulator('yc500');
    const { driver } = await connect(sim);
    const base = await driver.getKeymap('base');
    sim.sent.length = 0;
    await driver.setKeymap({
      ...base,
      slots: { ...base.slots, 2: { kind: 'keyboard', usage: 0x68, modifiers: 0 } },
    });
    expect(sim.sent.filter((op) => op === 0x13)).toHaveLength(1);
    expect(Array.from(sim.base.subarray(8, 12))).toEqual([0, 0, 0x68, 0]);
  });

  it('reports firmware that ignores single-key writes instead of claiming success', async () => {
    const sim = new RoyuanSimulator('yc500');
    sim.dropSlotWrites = true;
    const { driver } = await connect(sim);
    const base = await driver.getKeymap('base');
    await expect(
      driver.setKeymap({
        ...base,
        slots: { ...base.slots, 2: { kind: 'keyboard', usage: 0x68, modifiers: 0 } },
      }),
    ).rejects.toThrow(/did not keep 1 key/);
  });

  it('writes a gen2 layer as RK’s web driver does: nine packets, the last flagged, then a read-back', async () => {
    const sim = new RoyuanSimulator('gen2');
    const { driver } = await connect(sim);
    expect(driver.getCapabilities().keymap.write).toBe(true);
    expect(driver.getLayerIds()).toEqual(['base']);
    await driver.setKeymap({
      layer: 'base',
      slots: {
        0: { kind: 'keyboard', usage: 0x1d, modifiers: 0x01 },
        1: { kind: 'consumer', usage: 0xe9 },
      },
      provenance: 'device',
    });
    expect(sim.gen2Writes).toHaveLength(9);
    const first = sim.gen2Writes[0]!;
    expect([...first.subarray(0, 7)]).toEqual([0x0a, 1, 0xff, 0, 56, 0, 0]);
    expect(first[7]).toBe(0xff - (first.subarray(0, 7).reduce((x, y) => x + y, 0) & 0xff));
    expect([...first.subarray(8, 16)]).toEqual([0, 0, 0xe0, 0x1d, 0x03, 0, 0xe9, 0]);
    const last = sim.gen2Writes[8]!;
    expect([last[3], last[4], last[5]]).toEqual([8, 504 - 8 * 56, 1]);
    // Unchanged slots are written back as read.
    expect([...last.subarray(8, 12)]).toEqual([...sim.base.subarray(448, 452)]);
    expect((await driver.getKeymap('base')).slots[0]).toEqual({
      kind: 'keyboard',
      usage: 0x1d,
      modifiers: 0x01,
    });
  });

  it('reports a gen2 keyboard that did not keep the layer', async () => {
    const sim = new RoyuanSimulator('gen2');
    sim.dropSlotWrites = true;
    const { driver } = await connect(sim);
    await expect(
      driver.setKeymap({
        layer: 'base',
        slots: { 2: { kind: 'keyboard', usage: 0x05, modifiers: 0 } },
        provenance: 'device',
      }),
    ).rejects.toSatisfy((e) => e instanceof Error && /did not keep/.test(e.message));
  });

  it('keeps unknown slot encodings byte-for-byte', () => {
    expect(royuan.decodeSlot([0x09, 0, 2, 0], false)).toEqual({ kind: 'raw', bytes: [9, 0, 2, 0] });
    expect(royuan.encodeSlot({ kind: 'raw', bytes: [9, 0, 2, 0] }, false)).toEqual([9, 0, 2, 0]);
    expect(() => royuan.encodeSlot({ kind: 'keyboard', usage: 4, modifiers: 1 }, false)).toThrow();
    // gen2: one modifier with one key, as RK's web driver encodes Ctrl + Z.
    expect(royuan.encodeSlot({ kind: 'keyboard', usage: 0x1d, modifiers: 1 }, false, true)).toEqual(
      [0, 0, 0xe0, 0x1d],
    );
    expect(royuan.decodeSlot([0, 0, 0xe3, 0x2e], false, true)).toEqual({
      kind: 'keyboard',
      usage: 0x2e,
      modifiers: 0x08,
    });
    expect(() =>
      royuan.encodeSlot({ kind: 'keyboard', usage: 4, modifiers: 3 }, false, true),
    ).toThrow(/one modifier/);
  });
});

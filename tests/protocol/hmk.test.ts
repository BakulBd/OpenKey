import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { createDefaultRegistry, hmk, openDriver } from '@openkey/protocols';

async function connect(sim = new hmk.HmkSimulator()) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake', consent: ['hmk'] });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
  });
  return { sim, detection, driver: kb.driver as InstanceType<typeof hmk.HmkDriver> };
}

describe('libhmk keycodes', () => {
  it('maps every keyboard keycode to its HID usage and back', () => {
    for (let code = 0x02; code <= 0x82; code++) {
      const a = hmk.hmkToAction(code);
      expect(a.kind, `0x${code.toString(16)}`).toBe('keyboard');
      expect(hmk.actionToHmk(a)).toBe(code);
    }
    expect(hmk.hmkToAction(0x02)).toEqual({ kind: 'keyboard', usage: 0x04, modifiers: 0 }); // A
    expect(hmk.hmkToAction(0x64)).toMatchObject({ usage: 0x68 }); // F13
    expect(hmk.hmkToAction(0x7b)).toMatchObject({ usage: 0xe0 }); // LCtrl
    expect(hmk.hmkToAction(0x87)).toEqual({ kind: 'consumer', usage: 0xe9 }); // volume up
    expect(hmk.hmkToAction(0xc2)).toEqual({ kind: 'layer', layer: 2, mode: 'momentary' });
    expect(hmk.hmkToAction(0xee)).toEqual({ kind: 'raw', bytes: [0xee] });
    expect(hmk.actionToHmk({ kind: 'keyboard', usage: 0x04, modifiers: 2 })).toBeNull();
  });
});

describe('libhmk driver (firmware simulator)', () => {
  it('asks before identifying, then reads the layout from the keyboard metadata', async () => {
    const sim = new hmk.HmkSimulator();
    const asked = await createDefaultRegistry().detect(sim.device.group(), { level: 'handshake' });
    expect(asked.candidates.find((c) => c.protocol.id === 'hmk')?.consent?.required).toBe(true);
    expect(sim.commands).toEqual([]);
    const { driver, detection } = await connect(sim);
    expect(detection.selected).toMatchObject({ protocolId: 'hmk', identification: 'identified' });
    expect((await driver.getDeviceInfo()).model).toBe('OpenKey HMK demo HE');
    const layout = driver.getLayout();
    expect(layout.keys).toHaveLength(12);
    expect(layout.keys.find((k) => k.slot === 3)!.x).toBe(3.5);
    expect(layout.keys.find((k) => k.slot === 6)!.w).toBe(1.5);
    expect(driver.getLayerIds()).toHaveLength(4);
  });

  it('reads and writes the keymap with read-back, in one write for the changed range', async () => {
    const { driver, sim } = await connect();
    const base = await driver.getKeymap('base');
    expect(base.slots[0]).toEqual({ kind: 'keyboard', usage: 0x29, modifiers: 0 });
    expect(base.slots[11]).toEqual({ kind: 'layer', layer: 1, mode: 'momentary' });
    sim.commands.length = 0;
    await driver.setKeymap({
      ...base,
      slots: {
        ...base.slots,
        1: { kind: 'consumer', usage: 0xcd },
        4: { kind: 'keyboard', usage: 0x05, modifiers: 0 },
      },
    });
    expect(sim.commands.filter((c) => c === 129)).toHaveLength(1);
    expect([...sim.keymap[0]![0]!.subarray(0, 6)]).toEqual([0x27, 0x8c, 0x18, 0x06, 0x03, 0x15]);
  });

  it('reads and writes per-key actuation and Rapid Trigger', async () => {
    const { driver, sim } = await connect();
    expect(driver.getCapabilities().rapidTrigger.write).toBe(true);
    const before = await driver.getActuations();
    expect(before[0]).toEqual({ actuationPoint: 128, rtDown: 0, rtUp: 0, continuous: false });
    await driver.setActuations({
      2: { actuationPoint: 60, rtDown: 20, rtUp: 30, continuous: true },
      9: { actuationPoint: 200, rtDown: 0, rtUp: 0, continuous: false },
    });
    expect(sim.actuation[0]![2]).toEqual([60, 20, 30, 1]);
    expect(sim.actuation[0]![9]).toEqual([200, 0, 0, 0]);
    await expect(
      driver.setActuations({ 0: { actuationPoint: 300, rtDown: 0, rtUp: 0, continuous: false } }),
    ).rejects.toThrow(/0–255/);
  });

  it('never sends reboot, bootloader, reset or calibration, and never assigns the bootloader key', async () => {
    const { driver, sim } = await connect();
    const session = (driver as unknown as { session: InstanceType<typeof hmk.HmkSession> }).session;
    for (const id of Object.values(hmk.HMK_FORBIDDEN))
      await expect(session.command(id)).rejects.toThrow(/never sends/);
    const base = await driver.getKeymap('base');
    await expect(
      driver.setKeymap({ ...base, slots: { ...base.slots, 0: { kind: 'special', code: 0xd4 } } }),
    ).rejects.toThrow();
    expect(
      sim.commands.some((c) => (Object.values(hmk.HMK_FORBIDDEN) as number[]).includes(c)),
    ).toBe(false);
  });
});

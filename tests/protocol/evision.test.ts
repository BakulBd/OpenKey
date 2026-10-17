import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { createDefaultRegistry, evision, openDriver } from '@openkey/protocols';

const { EVisionSimulator, CUSTOM_MODE, packet } = evision;

async function connect(sim = new EVisionSimulator()) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
  });
  return { sim, detection, driver: kb.driver as InstanceType<typeof evision.EVisionDriver> };
}

describe('EVision keyboards', () => {
  it('builds packets with the 16-bit sum checksum over bytes 3–63', () => {
    const p = packet(0x06, 8, 0, [6, 4, 2, 0, 0, 255, 0, 0]);
    expect([...p.subarray(2, 7)]).toEqual([0x06, 8, 0, 0, 0]);
    const sum = 0x06 + 8 + 6 + 4 + 2 + 255;
    expect([p[0], p[1]]).toEqual([sum & 0xff, sum >> 8]);
    expect(() => packet(0x07, 0, 0, [])).toThrow(/not sent/);
  });

  it('identifies a listed board without sending anything and sets an effect', async () => {
    const { detection, driver, sim } = await connect();
    expect(detection.selected).toMatchObject({
      protocolId: 'evision',
      identification: 'identified',
    });
    expect(sim.packets).toEqual([]);
    await driver.setRgbConfig({
      effect: 0x05,
      color: { r: 0, g: 0, b: 255 },
      colorful: false,
      brightness: 3,
      speed: 4,
      direction: 'right',
    });
    expect([...sim.params]).toEqual([0x05, 3, 1, 1, 0, 0, 0, 255]);
  });

  it('writes the 126-LED colour table and switches to custom mode', async () => {
    const { driver, sim } = await connect();
    const w = driver.getLayout().keys.find((k) => k.id === 'W')!;
    expect(w.light).toBe(44);
    await driver.setPerKeyRgb({ 44: { r: 9, g: 8, b: 7 } });
    expect([...sim.colors.subarray(44 * 3, 44 * 3 + 3)]).toEqual([9, 8, 7]);
    expect(sim.packets.filter((p) => p[2] === 0x11)).toHaveLength(7);
    expect(sim.params[0]).toBe(CUSTOM_MODE);
  });
});

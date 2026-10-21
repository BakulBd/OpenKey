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

  it('shows the AJAZZ AK820 wired RGB with its own 82-key map and knob', async () => {
    const { driver, sim } = await connect(
      new EVisionSimulator({ vendorId: 0x320f, productId: 0x505b, productName: 'USB KEYBOARD' }),
    );
    expect((await driver.getDeviceInfo()).model).toBe('AJAZZ AK820 (wired RGB)');
    const layout = driver.getLayout();
    expect(layout.keys).toHaveLength(82);
    expect(layout.extras?.map((e) => e.kind)).toEqual(['knob']);
    // Indices from the official driver's picture, where this board differs from the full-size map.
    const light = (label: string, y: number) =>
      layout.keys.find((k) => k.label === label && k.y === y)?.light;
    expect(light('Esc', 0)).toBe(0);
    expect(light('Del', 0)).toBe(56);
    expect(light('Enter', 3.25)).toBe(75);
    expect(light('↑', 4.25)).toBe(96);
    expect(light('Fn', 5.25)).toBe(110);
    expect(light('→', 5.25)).toBe(115);
    await driver.setPerKeyRgb({ 96: { r: 1, g: 2, b: 3 } });
    expect([...sim.colors.subarray(96 * 3, 96 * 3 + 3)]).toEqual([1, 2, 3]);
    expect(driver.getCapabilities().perKeyRgb.value).toMatch(/82 keys/);
  });
});

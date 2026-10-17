import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { createDefaultRegistry, openDriver, semico } from '@openkey/protocols';

async function connect(
  sim = new semico.SemicoSimulator(),
  sleep: (ms: number) => Promise<void> = async () => undefined,
) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
    sleep,
  });
  return { sim, detection, driver: kb.driver as InstanceType<typeof semico.SemicoDriver> };
}

const cfg = (effect: number, brightness = 5, speed = 4) => ({
  effect,
  color: { r: 0, g: 0, b: 0 },
  colorful: false,
  brightness,
  speed,
  direction: 'right' as const,
});

describe('SEMICO firmware (AJAZZ AK992)', () => {
  it('identifies the AK992 from the vendor model list without sending anything', async () => {
    const { detection, sim } = await connect();
    expect(detection.selected).toMatchObject({
      protocolId: 'semico-lighting',
      identification: 'identified',
    });
    expect(sim.device.traffic).toEqual([]);
  });

  it('sends the vendor mode packet and remembers what it wrote', async () => {
    const { driver, sim } = await connect();
    await driver.setRgbConfig(cfg(3, 5, 4));
    expect([...sim.packets[0]!]).toEqual([0xff, 0xff, 0x02, 0x04, 0x03, 0x00, 0x00]);
    expect((await driver.getRgbConfig()).effect).toBe(3);
  });

  it('waits a second between mode changes to spare the keyboard’s memory', async () => {
    const waits: number[] = [];
    const { driver } = await connect(undefined, async (ms: number) => void waits.push(ms));
    await driver.setRgbConfig(cfg(1));
    await driver.setRgbConfig(cfg(5));
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(900);
  });

  it('refuses modes the firmware does not have', async () => {
    const { driver, sim } = await connect();
    await expect(driver.setRgbConfig(cfg(21))).rejects.toThrow(/not one of/);
    expect(sim.packets).toEqual([]);
  });
});

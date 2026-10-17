import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { createDefaultRegistry, openDriver, razer } from '@openkey/protocols';
import { noSleep } from '../helpers.js';

const { RazerSimulator, Effect, encode, crc } = razer;

async function connect(sim = new RazerSimulator()) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
    sleep: noSleep,
  });
  return { sim, detection, driver: kb.driver as InstanceType<typeof razer.RazerDriver> };
}

const cfg = (
  effect: number,
  extra: Partial<Parameters<InstanceType<typeof razer.RazerDriver>['setRgbConfig']>[0]> = {},
) => ({
  effect,
  color: { r: 255, g: 0, b: 0 },
  colorful: false,
  brightness: 128,
  speed: 2,
  direction: 'right' as const,
  ...extra,
});

describe('Razer Chroma', () => {
  it('builds reports with the transaction id, size, class, command and XOR checksum', () => {
    const r = encode(0x3f, { cls: 0x0f, id: 0x04, args: [1, 5, 0x80] });
    expect([...r.subarray(0, 11)]).toEqual([0, 0x3f, 0, 0, 0, 3, 0x0f, 0x04, 1, 5, 0x80]);
    expect(r[88]).toBe(crc(r));
    expect(r).toHaveLength(90);
  });

  it('identifies a BlackWidow V3 by its firmware read, waiting through a busy answer', async () => {
    const { detection, driver } = await connect();
    expect(detection.selected).toMatchObject({
      protocolId: 'razer-chroma',
      identification: 'identified',
    });
    expect(driver.firmware).toBe('1.4');
    expect(driver.model.set).toBe('ext');
    expect(driver.getLayout().keys).toHaveLength(6 * 22);
  });

  it('sets a stored static effect in the extended command set and reads brightness back', async () => {
    const { driver, sim } = await connect();
    await driver.setRgbConfig(cfg(Effect.STATIC));
    expect(sim.effect).toEqual([1, 5, 1, 0, 0, 1, 255, 0, 0]);
    expect(sim.brightness).toBe(128);
    expect(await driver.getRgbConfig()).toMatchObject({ effect: Effect.STATIC, brightness: 128 });
    await driver.setRgbConfig(cfg(Effect.WAVE, { direction: 'left' }));
    expect(sim.effect).toEqual([1, 5, 4, 2, 0x28, 0]);
  });

  it('uses the standard command set on older boards, and does not offer starlight there', async () => {
    const { driver, sim } = await connect(
      new RazerSimulator({
        vendorId: 0x1532,
        productId: 0x0203,
        productName: 'Razer BlackWidow Chroma',
      }),
    );
    await driver.setRgbConfig(cfg(Effect.BREATHING, { colorful: true }));
    expect(sim.effect).toEqual([3, 3, 0, 0, 0, 0, 0, 0]);
    expect(sim.commands.some((c) => c[6] === 0x03 && c[7] === 0x03)).toBe(true);
    expect(driver.getRgbEffects().effects.some((e) => e.id === Effect.STARLIGHT)).toBe(false);
    await expect(driver.setRgbConfig(cfg(Effect.STARLIGHT))).rejects.toThrow(/not offered/);
  });

  it('paints the LED matrix row by row and switches to the custom frame', async () => {
    const { driver, sim } = await connect();
    await driver.setPerKeyRgb({ 23: { r: 1, g: 2, b: 3 } });
    expect(sim.frame.size).toBe(6);
    expect(sim.frame.get(1)!.slice(3, 6)).toEqual([1, 2, 3]);
    expect(sim.effect.slice(0, 3)).toEqual([0, 0, 8]);
  });

  it('asks before probing a Razer device it does not list', async () => {
    const sim = new RazerSimulator({
      vendorId: 0x1532,
      productId: 0x0084,
      productName: 'Razer DeathAdder',
    });
    await createDefaultRegistry().detect(sim.device.group(), { level: 'handshake' });
    expect(sim.commands).toEqual([]);
  });
});

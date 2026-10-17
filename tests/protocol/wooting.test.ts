import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { createDefaultRegistry, openDriver, wooting } from '@openkey/protocols';

const { WootingSimulator, Effect, rgb565, wootingModel } = wooting;

async function connect(sim = new WootingSimulator()) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
  });
  return { sim, detection, driver: kb.driver as InstanceType<typeof wooting.WootingDriver> };
}

const cfg = (effect: number) => ({
  effect,
  color: { r: 255, g: 128, b: 0 },
  colorful: false,
  brightness: 10,
  speed: 0,
  direction: 'right' as const,
});

describe('Wooting (RGB SDK protocol)', () => {
  it('knows the SDK’s models, including the gamepad-driver product ids', () => {
    expect(wootingModel(0x31e3, 0x1400)?.name).toBe('Wooting 80HE');
    expect(wootingModel(0x31e3, 0x1402)?.name).toBe('Wooting 80HE');
    expect(wootingModel(0x31e3, 0x1403)).toBeUndefined();
    expect(wootingModel(0x03eb, 0xff02)?.name).toBe('Wooting Two');
  });

  it('identifies an 80HE with the device-config read and takes the lighting only when colours are set', async () => {
    const { detection, driver, sim } = await connect();
    expect(detection.selected).toMatchObject({
      protocolId: 'wooting-rgb',
      identification: 'identified',
    });
    expect(sim.commands).toEqual([19]);
    await driver.setRgbConfig(cfg(Effect.SOLID));
    expect(sim.commands).toEqual([19, 33]);
    const f = sim.frames[0]!;
    expect([...f.subarray(0, 3)]).toEqual([0xd0, 0xda, 0x0b]);
    const c = rgb565({ r: 255, g: 128, b: 0 });
    expect([f[3], f[4]]).toEqual([c & 0xff, c >> 8]);
    expect(f).toHaveLength(256);
  });

  it('sends per-key colours in four 64-byte reports on ARM boards, and gives the lighting back', async () => {
    const { driver, sim } = await connect(
      new WootingSimulator(
        { vendorId: 0x31e3, productId: 0x1310, productName: 'Wooting 60HE (ARM)' },
        64,
      ),
    );
    await driver.setPerKeyRgb({ 22: { r: 0, g: 0, b: 255 } });
    expect(sim.frames).toHaveLength(4);
    const cell = 3 + 22 * 2;
    expect([sim.frames[0]![cell], sim.frames[0]![cell + 1]]).toEqual([0x1f, 0x00]);
    await driver.setRgbConfig(cfg(Effect.KEYBOARD));
    expect(sim.commands.at(-1)).toBe(32);
  });
});

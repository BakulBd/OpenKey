import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { createDefaultRegistry, logitech, openDriver } from '@openkey/protocols';

const { LogitechSimulator, Effect, zoneOf, LOGO_ZONE } = logitech;

async function connect(sim = new LogitechSimulator()) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
  });
  return { sim, detection, driver: kb.driver as InstanceType<typeof logitech.LogitechDriver> };
}

describe('Logitech HID++ 2.0', () => {
  it('maps HID usages to per-key zones', () => {
    expect([zoneOf(0x04), zoneOf(0x29), zoneOf(0xe0), zoneOf(0xe7), zoneOf(0)]).toEqual([
      0x01,
      0x26,
      0x68,
      0x6f,
      null,
    ]);
  });

  it('identifies with the root ping, looks features up by id, reads the name and battery', async () => {
    const { detection, driver } = await connect();
    expect(detection.selected).toMatchObject({
      protocolId: 'logitech-hidpp',
      identification: 'identified',
    });
    expect(driver.version).toEqual({ major: 4, minor: 2 });
    expect(driver.features.get(0x8081)).toBe(13);
    expect(driver.name).toBe('G915 TKL LIGHTSPEED');
    expect(await driver.getBattery()).toEqual({ level: 76, charging: false });
    expect(driver.getLayout().keys.find((k) => k.id === 'A')!.light).toBe(1);
  });

  it('takes the lighting, paints keys in frames of four and ends the frame, then gives it back', async () => {
    const { driver, sim } = await connect();
    await driver.setPerKeyRgb({ 1: { r: 255, g: 0, b: 0 } });
    expect([sim.onboardMode, sim.swControl]).toEqual([2, 3]);
    expect(sim.zones.get(1)).toEqual([255, 0, 0]);
    expect(sim.zones.get(LOGO_ZONE)).toEqual([0, 0, 0]);
    expect(sim.frames).toBe(1);
    await driver.setRgbConfig({
      effect: Effect.ONBOARD,
      color: { r: 0, g: 0, b: 0 },
      colorful: false,
      brightness: 10,
      speed: 0,
      direction: 'right',
    });
    expect([sim.onboardMode, sim.swControl]).toEqual([1, 0]);
  });

  it('does not offer lighting on devices without the per-key feature', async () => {
    const { driver } = await connect(new LogitechSimulator(undefined, { perKey: false }));
    expect(driver.getCapabilities().rgb.write).toBe(false);
  });
});

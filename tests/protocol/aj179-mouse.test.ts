import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog, isMouseDriver } from '@openkey/core';
import { aj179Mouse, createDefaultRegistry, openDriver } from '@openkey/protocols';

const { Aj179Simulator, Light, dpiDecode, dpiEncode } = aj179Mouse;

async function connect(sim = new Aj179Simulator()) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
  });
  return { sim, detection, driver: kb.driver as InstanceType<typeof aj179Mouse.Aj179MouseDriver> };
}

describe('AJAZZ AJ179 mouse', () => {
  it('identifies the mouse with the vendor info read and reads every setting', async () => {
    const { driver, detection } = await connect();
    expect(detection.selected).toMatchObject({
      protocolId: 'aj179-mouse',
      identification: 'identified',
    });
    expect(isMouseDriver(driver)).toBe(true);
    expect(driver.info).toMatchObject({ id: 'M179', sensor: 0x95, battery: 82, connected: true });
    expect(await driver.getMouseSettings()).toEqual({
      pollingRate: 1000,
      dpi: [400, 800, 1200, 1600, 2400, 3200],
      dpiCount: 6,
      dpiIndex: 1,
      debounceMs: 8,
      sleep: 30,
      liftOff: 2,
      flags: { wakeOnMove: true, lightsOffOnMove: false, motionSync: false, angleSnap: false },
    });
    expect(driver.getMouseSchema().pollingRates).toEqual([125, 250, 500, 1000]);
    expect(await driver.getBattery()).toEqual({ level: 82, charging: false });
  });

  it('writes each setting group and reads it back', async () => {
    const { driver, sim } = await connect();
    await driver.setMouseSettings({
      pollingRate: 500,
      dpi: [800, 1600, 2400, 3200, 6400, 26000],
      dpiCount: 4,
      dpiIndex: 3,
      debounceMs: 2,
      sleep: 60,
      liftOff: 1,
      flags: { motionSync: true, angleSnap: true, wakeOnMove: false, lightsOffOnMove: true },
    });
    expect(await driver.getMouseSettings()).toMatchObject({
      pollingRate: 500,
      dpi: [800, 1600, 2400, 3200, 6400, 26000],
      dpiCount: 4,
      dpiIndex: 3,
      debounceMs: 2,
      sleep: 60,
      liftOff: 1,
      flags: { motionSync: true, angleSnap: true, wakeOnMove: false, lightsOffOnMove: true },
    });
    expect(sim.writes.map((w) => w[0])).toEqual([0x02, 0x03, 0x06, 0x07]);
  });

  it('changes only the group a setting belongs to', async () => {
    const { driver, sim } = await connect();
    await driver.setMouseSettings({ debounceMs: 4 });
    expect(sim.writes.map((w) => w[0])).toEqual([0x07]);
    expect(sim.power).toEqual([30, 1, 0, 4]);
  });

  it('sends a mode change twice so the new levels apply, then reads the lighting back', async () => {
    const { driver, sim } = await connect();
    await driver.setRgbConfig({
      effect: Light.BREATHING,
      color: { r: 0, g: 0, b: 0 },
      colorful: false,
      brightness: 4,
      speed: 1,
      direction: 'right',
    });
    expect(sim.writes.filter((w) => w[0] === 0x05)).toHaveLength(2);
    expect(await driver.getRgbConfig()).toMatchObject({
      effect: Light.BREATHING,
      brightness: 4,
      speed: 1,
    });
    await driver.setRgbConfig({
      effect: Light.BREATHING,
      color: { r: 0, g: 0, b: 0 },
      colorful: false,
      brightness: 2,
      speed: 3,
      direction: 'right',
    });
    // Same mode: one write.
    expect(sim.writes.filter((w) => w[0] === 0x05)).toHaveLength(3);
  });

  it('refuses values the mouse does not offer before sending anything', async () => {
    const { driver, sim } = await connect();
    for (const bad of [
      { pollingRate: 2000 },
      { debounceMs: 21 },
      { sleep: 7 },
      { liftOff: 3 },
      { dpiIndex: 5, dpiCount: 2 },
    ])
      await expect(driver.setMouseSettings(bad)).rejects.toThrow();
    await expect(
      driver.setRgbConfig({
        effect: 1,
        color: { r: 0, g: 0, b: 0 },
        colorful: false,
        brightness: 1,
        speed: 1,
        direction: 'right',
      }),
    ).rejects.toThrow(/not offered/);
    expect(sim.writes).toEqual([]);
  });

  it('explains a sleeping mouse instead of timing out', async () => {
    const { driver, sim } = await connect();
    sim.asleep = true;
    await expect(driver.getMouseSettings()).rejects.toThrow(/asleep/);
  });

  it('works over the USB cable identity', async () => {
    const { driver } = await connect(
      new Aj179Simulator({ vendorId: 0x248a, productId: 0x5c2e, productName: 'AJ179' }),
    );
    expect(driver.transport).toBe('usb');
    await driver.setMouseSettings({ debounceMs: 1 });
    expect((await driver.getMouseSettings()).debounceMs).toBe(1);
  });

  it('encodes DPI the way the vendor does for each sensor', () => {
    expect(dpiEncode(0x95, 800)).toBe(15);
    expect(dpiDecode(0x95, 15)).toBe(800);
    for (const [s, d] of [
      [0x11, 15000],
      [0x05, 9000],
      [0x25, 8000],
      [0x04, 4000],
      [0x96, 30000],
    ] as const)
      expect(dpiDecode(s, dpiEncode(s, d))).toBe(d);
  });

  it('never probes an identity that is not an AJ179', async () => {
    const sim = new Aj179Simulator({ vendorId: 0x1234, productId: 0x5c2f, productName: 'Other' });
    const report = await createDefaultRegistry().detect(sim.device.group(), { level: 'handshake' });
    expect(report.candidates.find((c) => c.protocol.id === 'aj179-mouse')?.match.applicable).toBe(
      false,
    );
    expect(sim.device.traffic).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { createDefaultRegistry, openDriver, yjxMouse } from '@openkey/protocols';

const { YjxMouseSimulator, Field } = yjxMouse;

async function connect(sim = new YjxMouseSimulator()) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
  });
  return { sim, detection, driver: kb.driver as InstanceType<typeof yjxMouse.YjxMouseDriver> };
}

describe('AJAZZ AJ139 V2 MC (YJX mouse firmware)', () => {
  it('identifies the mouse with its read-only settings read and reads the settings', async () => {
    const { driver, detection } = await connect();
    expect(detection.selected).toMatchObject({
      protocolId: 'yjx-mouse',
      identification: 'identified',
    });
    expect(await driver.getMouseConfig()).toMatchObject({
      pollingRate: 1000,
      debounceMs: 4,
      dpi: [400, 800, 1200, 1600, 2400, 3200],
      dpiIndex: 1,
      sleepMinutes: 10,
    });
    expect(driver.getCapabilities().debounce).toMatchObject({ write: true, read: 'device' });
    expect(driver.info).toContain('YJX.co.mouse');
    expect(await driver.getBattery()).toEqual({ level: 87, charging: false });
  });

  it('changes debounce only, keeping every other byte of the settings block', async () => {
    const { driver, sim } = await connect();
    const before = sim.block.slice();
    await driver.setMouseConfig({ debounceMs: 8 });
    expect(sim.block[Field.DEBOUNCE]).toBe(8);
    for (let i = 9; i < 64; i++)
      if (i !== Field.DEBOUNCE) expect(sim.block[i], `byte ${i}`).toBe(before[i]);
    expect(sim.block[30]).toBe(0x77); // undocumented byte left as the mouse had it
    expect((await driver.getMouseConfig()).debounceMs).toBe(8);
  });

  it('writes polling rate, DPI levels, sleep and wake-up, with read-back', async () => {
    const { driver } = await connect();
    await driver.setPollingRate(2000);
    await driver.setMouseConfig({
      dpi: [800, 1600, 2400, 3200, 6400, 12000],
      dpiCount: 4,
      dpiIndex: 2,
      sleepMinutes: 30,
      wakeOnClick: true,
    });
    expect(await driver.getMouseConfig()).toMatchObject({
      pollingRate: 2000,
      dpi: [800, 1600, 2400, 3200, 6400, 12000],
      dpiCount: 4,
      dpiIndex: 2,
      sleepMinutes: 30,
      wakeOnClick: true,
    });
  });

  it('refuses values outside the documented choices before sending anything', async () => {
    const { driver, sim } = await connect();
    for (const bad of [
      { debounceMs: 0 },
      { debounceMs: 21 },
      { pollingRate: 333 },
      { sleepMinutes: 7 },
      { dpiIndex: 5, dpiCount: 3 },
    ])
      await expect(driver.setMouseConfig(bad)).rejects.toThrow();
    expect(sim.writes).toHaveLength(0);
  });

  it('asks before probing anything that is not an AJ139 V2 MC identity', async () => {
    const sim = new YjxMouseSimulator({
      vendorId: 0x1234,
      productId: 0x2255,
      productName: 'Other mouse',
    });
    const report = await createDefaultRegistry().detect(sim.device.group(), { level: 'handshake' });
    expect(report.candidates.find((c) => c.protocol.id === 'yjx-mouse')?.match.applicable).toBe(
      false,
    );
    expect(report.selected?.identification).not.toBe('identified');
    expect(sim.device.traffic.filter((t) => t.op === 'output')).toEqual([]);
  });

  it('works through the 2.4 GHz receiver identity too', async () => {
    const { driver } = await connect(
      new YjxMouseSimulator({
        vendorId: 0xa8a5,
        productId: 0x2255,
        productName: 'AJ139 V2 MC 2.4G',
      }),
    );
    await driver.setMouseConfig({ debounceMs: 2 });
    expect((await driver.getMouseConfig()).debounceMs).toBe(2);
  });
});

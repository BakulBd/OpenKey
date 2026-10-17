import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { DirectEffect, createDefaultRegistry, oemDirect, openDriver } from '@openkey/protocols';
import type { DirectLightingDriver } from '@openkey/protocols';

async function connect(sim: InstanceType<typeof oemDirect.DirectSimulator>) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
  });
  return { detection, driver: kb.driver as DirectLightingDriver };
}

const solid = (r: number, g: number, b: number) => ({
  effect: DirectEffect.SOLID,
  color: { r, g, b },
  colorful: false,
  brightness: 10,
  speed: 0,
  direction: 'right' as const,
});

describe('direct-lighting keyboards (OpenRGB facts)', () => {
  it('Bloody B820R: takes control, sends the three colour planes in halves, gives control back', async () => {
    const sim = oemDirect.bloodyB820RSimulator();
    const { detection, driver } = await connect(sim);
    expect(detection.selected).toMatchObject({
      protocolId: 'bloody-b820r',
      identification: 'identified',
    });
    expect(sim.reports).toEqual([]);
    const w = driver.getLayout().keys.find((k) => k.id === 'W')!.light!;
    await driver.setPerKeyRgb({ [w]: { r: 10, g: 20, b: 30 } });
    const [take1, take2, r1, , g1, , b1] = sim.reports.map((r) => [...r.data]);
    expect(take1!.slice(0, 3)).toEqual([0x03, 0x06, 0x01]);
    expect(take2!.slice(0, 8)).toEqual([0x03, 0x06, 0x00, 0, 0, 0, 0, 0x01]);
    expect([r1![2], r1![5 + w], g1![5 + w], b1![5 + w]]).toEqual([0x07, 10, 20, 30]);
    await driver.setRgbConfig({ ...solid(0, 0, 0), effect: DirectEffect.KEYBOARD });
    expect([...sim.reports.at(-1)!.data.subarray(0, 8)]).toEqual([
      0x03, 0x06, 0x00, 0, 0, 0, 0, 0x00,
    ]);
  });

  it('HyperX Alloy Origins: initialisation, 9 packets of 81 R G B with the firmware’s gaps', async () => {
    const sim = oemDirect.hyperxOriginsSimulator();
    const { driver } = await connect(sim);
    await driver.setRgbConfig(solid(255, 0, 0));
    expect(sim.reports).toHaveLength(10);
    expect([...sim.reports[0]!.data.subarray(0, 9)]).toEqual([0x04, 0xf2, 0, 0, 0, 0, 0, 0, 0x09]);
    const first = sim.reports[1]!.data;
    expect([...first.subarray(0, 4)]).toEqual([0x81, 255, 0, 0]);
    // Wire slot 23 is a gap: black even in solid red.
    const slot23 = sim.reports[2]!.data.subarray((23 - 16) * 4, (23 - 16) * 4 + 4);
    expect([...slot23]).toEqual([0x81, 0, 0, 0]);
    // No release command exists, so the keyboard's own lighting is not offered.
    expect(driver.getRgbEffects().effects.some((e) => e.id === DirectEffect.KEYBOARD)).toBe(false);
  });

  it('Ducky One 2 RGB: init, colour header, 8 data packets and the terminator; never a guessed release', async () => {
    const sim = oemDirect.duckySimulator();
    const { driver } = await connect(sim);
    await driver.setRgbConfig(solid(1, 2, 3));
    const heads = sim.reports.map((r) => r.data[0]!.toString(16) + ':' + r.data[1]!.toString(16));
    expect(heads).toEqual(['41:1', '56:81', ...new Array(8).fill('56:83'), '51:28']);
    expect([...sim.reports[2]!.data.subarray(24, 27)]).toEqual([1, 2, 3]);
    expect(driver.getLayout().keys.find((k) => k.id === 'Esc')!.light).toBe(0);
  });
});

describe('SteelSeries Apex', () => {
  it('reads the firmware, picks generation 3 from 1.19.7 on, initialises and sends usage-addressed frames', async () => {
    const sim = new oemDirect.SteelSeriesSimulator(0x1614, '1.19.7');
    const { detection, driver } = await connect(
      sim as unknown as InstanceType<typeof oemDirect.DirectSimulator>,
    );
    expect(detection.selected).toMatchObject({
      protocolId: 'steelseries-apex',
      identification: 'identified',
    });
    const apex = driver as InstanceType<typeof oemDirect.SteelSeriesApexDriver>;
    expect([apex.firmware, apex.gen]).toEqual(['1.19.7', 3]);
    const a = driver.getLayout().keys.find((k) => k.id === 'A')!;
    expect(a.light).toBe(0);
    await driver.setPerKeyRgb({ 0: { r: 7, g: 8, b: 9 } });
    expect(sim.commands).toContain(0x4b);
    const f = sim.frames[0]!;
    expect([...f.subarray(0, 6)]).toEqual([0x40, 112, 0x04, 7, 8, 9]);
    await driver.setRgbConfig({
      effect: DirectEffect.KEYBOARD,
      color: { r: 0, g: 0, b: 0 },
      colorful: false,
      brightness: 10,
      speed: 0,
      direction: 'right',
    });
    expect(sim.commands.at(-1)).toBe(0x41);
  });

  it('uses the first-generation packets on older firmware', async () => {
    const sim = new oemDirect.SteelSeriesSimulator(0x1614, '1.18.0');
    const { driver } = await connect(
      sim as unknown as InstanceType<typeof oemDirect.DirectSimulator>,
    );
    await driver.setRgbConfig({
      effect: DirectEffect.SOLID,
      color: { r: 1, g: 1, b: 1 },
      colorful: false,
      brightness: 10,
      speed: 0,
      direction: 'right',
    });
    expect(sim.frames[0]![0]).toBe(0x3a);
    expect(sim.commands).not.toContain(0x4b);
  });
});

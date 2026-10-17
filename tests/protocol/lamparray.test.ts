import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { parseReportDescriptor } from '@openkey/hid';
import { createDefaultRegistry, lampArray, openDriver } from '@openkey/protocols';

const { LampArraySimulator, Effect, REFERENCE_IDS, reportMap } = lampArray;

async function connect(sim = new LampArraySimulator()) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
  });
  return { sim, detection, driver: kb.driver as InstanceType<typeof lampArray.LampArrayDriver> };
}

/** Microsoft's reference LampArray descriptor (report IDs 1–6, 8 lamps per multi-update). */
const REFERENCE_DESCRIPTOR = [
  // Usage Page (Lighting), Usage (LampArray), Collection (Application)
  0x05, 0x59, 0x09, 0x01, 0xa1, 0x01,
  // LampArrayAttributesReport: id 1, u16 + 5 × u32
  0x85, 0x01, 0x09, 0x02, 0xa1, 0x02, 0x09, 0x03, 0x15, 0x00, 0x27, 0xff, 0xff, 0x00, 0x00, 0x75,
  0x10, 0x95, 0x01, 0xb1, 0x03, 0x09, 0x04, 0x09, 0x05, 0x09, 0x06, 0x09, 0x07, 0x09, 0x08, 0x15,
  0x00, 0x27, 0xff, 0xff, 0xff, 0x7f, 0x75, 0x20, 0x95, 0x05, 0xb1, 0x03, 0xc0,
  // LampAttributesRequestReport: id 2, u16
  0x85, 0x02, 0x09, 0x20, 0xa1, 0x02, 0x09, 0x21, 0x15, 0x00, 0x27, 0xff, 0xff, 0x00, 0x00, 0x75,
  0x10, 0x95, 0x01, 0xb1, 0x02, 0xc0,
  // LampAttributesResponseReport: id 3, u16 + 5 × u32 + 6 × u8
  0x85, 0x03, 0x09, 0x22, 0xa1, 0x02, 0x09, 0x21, 0x15, 0x00, 0x27, 0xff, 0xff, 0x00, 0x00, 0x75,
  0x10, 0x95, 0x01, 0xb1, 0x02, 0x09, 0x23, 0x09, 0x24, 0x09, 0x25, 0x09, 0x27, 0x09, 0x26, 0x15,
  0x00, 0x27, 0xff, 0xff, 0xff, 0x7f, 0x75, 0x20, 0x95, 0x05, 0xb1, 0x02, 0x09, 0x28, 0x09, 0x29,
  0x09, 0x2a, 0x09, 0x2b, 0x09, 0x2c, 0x09, 0x2d, 0x15, 0x00, 0x25, 0xff, 0x75, 0x08, 0x95, 0x06,
  0xb1, 0x02, 0xc0,
  // LampMultiUpdateReport: id 4, 2 × u8 + 8 × u16 + 32 × u8
  0x85, 0x04, 0x09, 0x50, 0xa1, 0x02, 0x09, 0x03, 0x09, 0x55, 0x15, 0x00, 0x25, 0x08, 0x75, 0x08,
  0x95, 0x02, 0xb1, 0x02, 0x09, 0x21, 0x15, 0x00, 0x27, 0xff, 0xff, 0x00, 0x00, 0x75, 0x10, 0x95,
  0x08, 0xb1, 0x02, 0x09, 0x51, 0x15, 0x00, 0x26, 0xff, 0x00, 0x75, 0x08, 0x95, 0x20, 0xb1, 0x02,
  0xc0,
  // LampRangeUpdateReport: id 5, u8 + 2 × u16 + 4 × u8
  0x85, 0x05, 0x09, 0x60, 0xa1, 0x02, 0x09, 0x55, 0x15, 0x00, 0x25, 0x01, 0x75, 0x08, 0x95, 0x01,
  0xb1, 0x02, 0x09, 0x61, 0x09, 0x62, 0x15, 0x00, 0x27, 0xff, 0xff, 0x00, 0x00, 0x75, 0x10, 0x95,
  0x02, 0xb1, 0x02, 0x09, 0x51, 0x09, 0x52, 0x09, 0x53, 0x09, 0x54, 0x15, 0x00, 0x26, 0xff, 0x00,
  0x75, 0x08, 0x95, 0x04, 0xb1, 0x02, 0xc0,
  // LampArrayControlReport: id 6, u8
  0x85, 0x06, 0x09, 0x70, 0xa1, 0x02, 0x09, 0x71, 0x15, 0x00, 0x25, 0x01, 0x75, 0x08, 0x95, 0x01,
  0xb1, 0x02, 0xc0, 0xc0,
];

describe('HID LampArray', () => {
  it('finds the six reports in the reference descriptor parsed on Linux', () => {
    const [c] = parseReportDescriptor(Uint8Array.from(REFERENCE_DESCRIPTOR));
    expect(c).toMatchObject({ usagePage: 0x59, usage: 0x01 });
    expect(c!.children?.map((ch) => ch.usage)).toEqual([0x02, 0x20, 0x22, 0x50, 0x60, 0x70]);
    expect(reportMap(c!)).toEqual({ ...REFERENCE_IDS, multiCapacity: 8 });
  });

  it('refuses a collection whose report layout is not exposed or not standard', () => {
    const flat = { ...lampArray.lampArrayCollection(), children: undefined };
    expect(reportMap(flat)).toMatch(/does not expose/);
    const odd = lampArray.lampArrayCollection();
    odd.children![0]!.featureReports = [{ reportId: 1, size: 20 }];
    expect(reportMap(odd)).toMatch(/non-standard/);
  });

  it('identifies with a public-standard read, without asking, and builds the layout from the lamps', async () => {
    const { detection, driver, sim } = await connect();
    expect(detection.selected).toMatchObject({
      protocolId: 'hid-lamparray',
      identification: 'identified',
    });
    expect(sim.device.traffic.filter((t) => t.op !== 'feature-get' && t.reportId !== 2)).toEqual(
      [],
    );
    const layout = driver.getLayout();
    expect(layout.keys).toHaveLength(9);
    expect(layout.keys[0]).toMatchObject({ label: 'Esc', light: 0, usage: 0x29, x: 0, y: 0 });
    expect(layout.keys.find((k) => k.usage === 0x2c)?.label).toBe('Space');
    expect(layout.keys[7]).toMatchObject({ label: 'Logo', usage: 0 });
    // A lamp the keyboard marks as not programmable gets no LED index.
    expect(layout.keys[8]!.light).toBeNull();
    expect((await driver.getDeviceInfo()).fields.find((f) => f.key === 'lamps')?.value).toBe(9);
  });

  it('reads lamps from devices that do not advance the lamp id on their own', async () => {
    const { driver } = await connect(new LampArraySimulator(undefined, { autoAdvance: false }));
    expect(driver.lamps.map((l) => l.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('writes per-key colours as multi-update frames and takes the lamps from the keyboard', async () => {
    const { driver, sim } = await connect(new LampArraySimulator(undefined, { capacity: 3 }));
    expect(sim.autonomous).toBe(true);
    await driver.setPerKeyRgb({ 0: { r: 255, g: 0, b: 0 }, 6: { r: 0, g: 0, b: 255 } });
    expect(sim.autonomous).toBe(false);
    expect(sim.colors.get(0)).toEqual([255, 0, 0, 1]);
    expect(sim.colors.get(6)).toEqual([0, 0, 255, 1]);
    expect(sim.colors.get(1)).toEqual([0, 0, 0, 1]);
    expect(sim.colors.has(8)).toBe(false);
    // 8 programmable lamps, 3 per report: 3 reports, one frame completed.
    expect(
      sim.device.traffic.filter((t) => t.op === 'feature-set' && t.reportId === 4),
    ).toHaveLength(3);
    expect(sim.frames).toHaveLength(1);
    expect(await driver.getPerKeyRgb()).toEqual({
      0: { r: 255, g: 0, b: 0 },
      6: { r: 0, g: 0, b: 255 },
    });
    expect((await driver.getRgbConfig()).effect).toBe(Effect.PER_KEY);
  });

  it('sets a solid colour with brightness, turns the lamps off and gives the lighting back', async () => {
    const { driver, sim } = await connect();
    const base = await driver.getRgbConfig();
    await driver.setRgbConfig({
      ...base,
      effect: Effect.SOLID,
      color: { r: 200, g: 100, b: 0 },
      brightness: 5,
    });
    expect(sim.colors.get(3)).toEqual([100, 50, 0, 1]);
    await driver.setRgbConfig({ ...base, effect: Effect.OFF });
    expect(sim.colors.get(3)).toEqual([0, 0, 0, 1]);
    await driver.setRgbConfig({ ...base, effect: Effect.DEVICE });
    expect(sim.autonomous).toBe(true);
    await expect(driver.setRgbConfig({ ...base, effect: 9 })).rejects.toThrow(/not offered/);
  });

  it('scales colours to lamps with fewer levels', () => {
    expect(lampArray.toLevel(255, 255)).toBe(255);
    expect(lampArray.toLevel(200, 1)).toBe(1);
    expect(lampArray.toLevel(100, 1)).toBe(0);
    expect(lampArray.toLevel(255, 16)).toBe(15);
  });
});

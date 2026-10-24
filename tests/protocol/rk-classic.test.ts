import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog, writeDecision } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import type { MockTraffic } from '@openkey/hid';
import { createDefaultRegistry, openDriver, rkClassic } from '@openkey/protocols';

const channel = {
  usagePage: 0x0001,
  usage: 0x0080,
  inputReports: [],
  outputReports: [],
  featureReports: [{ reportId: 0x0a, size: 64 }],
};
const rk = (productId: number, productName = 'RK keyboard') =>
  new MockHidDevice({ vendorId: 0x258a, productId, productName }, [
    { info: { collections: [channel] }, behavior: { onFeatureSet: () => undefined } },
  ]);

async function connect(dev: MockHidDevice, store = new MemoryStateStore()) {
  const registry = createDefaultRegistry();
  const detection = await registry.detect(dev.group(), { level: 'handshake' });
  const kb = await openDriver(dev.group(), detection, { registry, log: new PacketLog(), store });
  return { driver: kb.driver as InstanceType<typeof rkClassic.RkClassicDriver>, detection, store };
}

describe('classic RK protocol', () => {
  it('builds the lighting packet as RK’s software does', () => {
    const p = rkClassic.lightingPacket({
      effect: 17,
      speed: 3,
      brightness: 5,
      color: { r: 1, g: 2, b: 3 },
      colorful: false,
      sleep: 5,
    });
    expect(Array.from(p.subarray(0, 13))).toEqual([
      0x01, 0x01, 0x02, 0x29, 17, 0, 3, 5, 1, 2, 3, 0, 5,
    ]);
    expect(p.length).toBe(64);
  });

  it('recognises listed RK models without sending anything', async () => {
    const dev = rk(0x004a, 'RK61RGB Wired');
    const { driver, detection } = await connect(dev);
    expect(detection.selected).toMatchObject({
      protocolId: 'rk-classic',
      identification: 'identified',
    });
    expect(dev.traffic).toEqual([]);
    expect((await driver.getDeviceInfo()).model).toBe('RK RK61RGB Wired');
  });

  it('never claims an unlisted 258A keyboard with the same report', async () => {
    const r = await createDefaultRegistry().detect(rk(0x0999).group(), { level: 'handshake' });
    expect(r.candidates.find((c) => c.protocol.id === 'rk-classic')!.match.applicable).toBe(false);
  });

  it('sends one lighting packet, mirrors it, and keeps sleep in the same packet', async () => {
    const dev = rk(0x0078, 'RK87');
    const { driver, store } = await connect(dev);
    const cfg = await driver.getRgbConfig();
    await driver.setRgbConfig({ ...cfg, effect: 18, brightness: 4, colorful: true });
    await driver.setSystemSettings({ sleepTime: 2 });
    const sets = dev.traffic.filter((t: MockTraffic) => t.op === 'feature-set');
    expect(sets).toHaveLength(2);
    expect(sets.every((t: MockTraffic) => t.reportId === 0x0a)).toBe(true);
    expect(Array.from(sets[1]!.data.subarray(4, 13))).toEqual([18, 0, 3, 4, 0, 0, 0, 1, 2]);
    const again = await connect(dev, store);
    expect(await again.driver.getRgbConfig()).toMatchObject({
      effect: 18,
      brightness: 4,
      colorful: true,
    });
  });

  it('uses the single-colour effect table where RK does, and keeps writes experimental', async () => {
    const { driver } = await connect(rk(0x0060, 'RK61'));
    expect(driver.getRgbEffects().effects[0]).toMatchObject({ id: 1, name: 'Steady' });
    await expect(
      driver.setRgbConfig({ ...(await driver.getRgbConfig()), effect: 21 }),
    ).rejects.toThrow(/not in this model/);
    expect(
      writeDecision(driver.getCapabilities().rgb, { simulated: false, experimentalEnabled: false })
        .kind,
    ).toBe('experimental');
  });

  describe('key maps and per-key colours from RK’s key table', () => {
    const sets = (dev: MockHidDevice) =>
      dev.traffic.filter((t: MockTraffic) => t.op === 'feature-set').map((t) => t.data);

    it('draws the RK61 from RK’s own key rectangles, with its table indices', async () => {
      const { driver } = await connect(rk(0x004a, 'RK61RGB Wired'));
      const layout = driver.getLayout();
      expect(layout.keys).toHaveLength(61);
      const esc = layout.keys.find((k) => k.label === 'Esc')!;
      expect([esc.slot, esc.light, esc.usage, esc.x, esc.y]).toEqual([1, 1, 0x29, 0, 0]);
      expect(layout.keys.find((k) => k.label === 'Fn')!.slot).toBe(-1);
      expect(layout.width).toBeGreaterThan(14);
      expect(layout.width).toBeLessThan(16);
      const caps = driver.getCapabilities();
      expect([caps.keymap.write, caps.perKeyRgb.write]).toEqual([true, true]);
    });

    it('writes the whole table: factory codes, the changed key, Fn unchanged', async () => {
      const dev = rk(0x004a, 'RK61RGB Wired');
      const { driver } = await connect(dev);
      const caps = driver.getLayout().keys.find((k) => k.label === 'Caps')!;
      await driver.setKeymap({
        layer: 'base',
        slots: {
          [caps.slot]: { kind: 'keyboard', usage: 0x06, modifiers: 0x01 },
          1: { kind: 'consumer', usage: 0xe9 },
        },
        provenance: 'mirror',
      });
      const r = sets(dev);
      expect(r).toHaveLength(9);
      expect([...r[0]!.subarray(0, 4)]).toEqual([9, 1, 0x01, 0xf8]);
      expect([...r[8]!.subarray(0, 2)]).toEqual([9, 9]);
      const table = new Uint8Array([
        ...r[0]!.subarray(4),
        ...r.slice(1).flatMap((x) => [...x.subarray(2)]),
      ]);
      const at = (i: number) => [...table.subarray(i * 4, i * 4 + 4)];
      expect(at(caps.slot)).toEqual([0x00, 0x01, 0x06, 0x00]); // Ctrl+C
      expect(at(1)).toEqual([0x01, 0x00, 0x00, 0xe9]); // Esc → volume up
      const a = driver.getLayout().keys.find((k) => k.label === 'A')!;
      expect(at(a.slot)).toEqual([0, 0, 0x04, 0]);
      const fn = driver.getLayout().keys.find((k) => k.label === 'Fn')!;
      expect(at(Number(fn.id.slice(1)))).toEqual([0, 0, 0xb0, 0]);
      const shift = driver.getLayout().keys.find((k) => k.label === 'Shift')!;
      expect(at(shift.slot)).toEqual([0, 0x02, 0, 0]);
      expect((await driver.getKeymap()).slots[1]).toEqual({ kind: 'consumer', usage: 0xe9 });
    });

    it('refuses actions the table cannot hold, before sending anything', async () => {
      const dev = rk(0x004a, 'RK61RGB Wired');
      const { driver } = await connect(dev);
      await expect(
        driver.setKeymap({
          layer: 'base',
          slots: { 1: { kind: 'macro', index: 0, mode: 'once', repeat: 1 } },
          provenance: 'mirror',
        }),
      ).rejects.toThrow(/cannot hold/);
      expect(sets(dev)).toEqual([]);
    });

    it('selects the Custom effect, then sends the 7 colour reports', async () => {
      const dev = rk(0x004a, 'RK61RGB Wired');
      const { driver } = await connect(dev);
      await driver.setPerKeyRgb({ 1: { r: 255, g: 0, b: 0 }, 7: { r: 0, g: 0, b: 255 } });
      const r = sets(dev);
      expect(r).toHaveLength(8);
      expect(r[0]![4]).toBe(14);
      expect([...r[1]!.subarray(0, 5)]).toEqual([7, 1, 0x03, 0x7e, 0x01]);
      expect([...r[1]!.subarray(5 + 3, 5 + 6)]).toEqual([255, 0, 0]);
      expect([...r[1]!.subarray(5 + 21, 5 + 24)]).toEqual([0, 0, 255]);
      expect((await driver.getRgbConfig()).effect).toBe(14);
      expect(driver.getRgbEffects().customEffect).toBe(14);
    });

    it('offers no per-key colours on a single-colour board, and no key map where a key type is unknown', async () => {
      const single = (await connect(rk(0x0060, 'RK61'))).driver.getCapabilities();
      expect([single.keymap.write, single.perKeyRgb.write]).toEqual([true, false]);
      const odd = (await connect(rk(0x00d6, 'RK'))).driver.getCapabilities();
      expect(odd.keymap.write).toBe(false);
    });

    it('has a key table for every model on RK’s list, each code known', async () => {
      for (const [pid] of rkClassic.RK_CLASSIC_MODELS) {
        const keys = await rkClassic.rkModelKeys(pid);
        expect(keys, pid.toString(16)).not.toBeNull();
        for (const [, , , , vk, , type] of keys!.keys)
          if (type === undefined) expect(() => rkClassic.factoryCode(vk)).not.toThrow();
      }
    });
  });
});

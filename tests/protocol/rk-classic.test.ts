import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog, writeDecision } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import type { MockTraffic } from '@openkey/hid';
import { createDefaultRegistry, openDriver, rkClassic } from '@openkey/protocols';

const channel = { usagePage: 0x0001, usage: 0x0080, inputReports: [], outputReports: [], featureReports: [{ reportId: 0x0a, size: 64 }] };
const rk = (productId: number, productName = 'RK keyboard') => new MockHidDevice({ vendorId: 0x258a, productId, productName }, [{ info: { collections: [channel] }, behavior: { onFeatureSet: () => undefined } }]);

async function connect(dev: MockHidDevice, store = new MemoryStateStore()) {
  const registry = createDefaultRegistry();
  const detection = await registry.detect(dev.group(), { level: 'handshake' });
  const kb = await openDriver(dev.group(), detection, { registry, log: new PacketLog(), store });
  return { driver: kb.driver as InstanceType<typeof rkClassic.RkClassicDriver>, detection, store };
}

describe('classic RK protocol', () => {
  it('builds the lighting packet as RK’s software does', () => {
    const p = rkClassic.lightingPacket({ effect: 17, speed: 3, brightness: 5, color: { r: 1, g: 2, b: 3 }, colorful: false, sleep: 5 });
    expect(Array.from(p.subarray(0, 13))).toEqual([0x01, 0x01, 0x02, 0x29, 17, 0, 3, 5, 1, 2, 3, 0, 5]);
    expect(p.length).toBe(64);
  });

  it('recognises listed RK models without sending anything', async () => {
    const dev = rk(0x004a, 'RK61RGB Wired');
    const { driver, detection } = await connect(dev);
    expect(detection.selected).toMatchObject({ protocolId: 'rk-classic', identification: 'identified' });
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
    expect(await again.driver.getRgbConfig()).toMatchObject({ effect: 18, brightness: 4, colorful: true });
  });

  it('uses the single-colour effect table where RK does, and keeps writes experimental', async () => {
    const { driver } = await connect(rk(0x0060, 'RK61'));
    expect(driver.getRgbEffects().effects[0]).toMatchObject({ id: 1, name: 'Steady' });
    await expect(driver.setRgbConfig({ ...(await driver.getRgbConfig()), effect: 21 })).rejects.toThrow(/not in this model/);
    expect(writeDecision(driver.getCapabilities().rgb, { simulated: false, experimentalEnabled: false }).kind).toBe('experimental');
  });
});

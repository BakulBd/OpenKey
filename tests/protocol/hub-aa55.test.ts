import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { createDefaultRegistry, hubAa55, openDriver } from '@openkey/protocols';

const { HubSimulator, CUSTOM_MODE, requests } = hubAa55;

async function connect(sim = new HubSimulator()) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
  });
  return { sim, detection, driver: kb.driver as InstanceType<typeof hubAa55.HubDriver> };
}

const cfg = (effect: number, brightness = 4, speed = 2) => ({
  effect,
  color: { r: 10, g: 20, b: 30 },
  colorful: false,
  brightness,
  speed,
  direction: 'right' as const,
});

describe('AULA/AJAZZ web-driver protocol (AA/55)', () => {
  it('splits transfers into acknowledged packets with offsets and a last flag', () => {
    const r = requests(0x24, new Uint8Array(512), 64);
    expect(r).toHaveLength(10);
    expect([...r[0]!.subarray(0, 8)]).toEqual([0xaa, 0x24, 0x38, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect([...r[9]!.subarray(0, 8)]).toEqual([0xaa, 0x24, 0x08, 0xf8, 0x01, 0x00, 0x01, 0x00]);
    expect(() => requests(0x4f, new Uint8Array(1), 64)).toThrow(/not sent/);
  });

  it('identifies the F87S with the device-info read and reads firmware, battery and lighting', async () => {
    const { detection, driver } = await connect();
    expect(detection.selected).toMatchObject({
      protocolId: 'hub-aa55',
      identification: 'identified',
    });
    expect(driver.info).toMatchObject({
      vendorId: 0x38a6,
      productId: 0x2908,
      firmware: '1.23',
      battery: 100,
    });
    expect(driver.lighting).toBe(true);
    expect(await driver.getRgbConfig()).toMatchObject({ effect: 15, brightness: 5, speed: 3 });
    expect(driver.getLayout().keys.filter((k) => k.light !== null)).toHaveLength(87);
    expect(driver.getLayout().keys.find((k) => k.id === 'W')?.light).toBe(34);
  });

  it('changes the effect in place, keeping the bytes it does not know, and reads it back', async () => {
    const { driver, sim } = await connect();
    await driver.setRgbConfig(cfg(3));
    expect([...sim.effect]).toEqual([3, 10, 20, 30, 255, 0, 0, 0, 1, 4, 2, 0, 0, 0, 0xaa, 0x55]);
    await expect(driver.setRgbConfig(cfg(3, 6))).rejects.toThrow(/turn the lights off/);
  });

  it('writes per-key colours as the whole table, keeping slots outside the key map, then shows them', async () => {
    const { driver, sim } = await connect();
    const before = sim.table.slice();
    await driver.setPerKeyRgb({ 34: { r: 255, g: 0, b: 0 } });
    expect([...sim.table.subarray(34 * 4, 34 * 4 + 4)]).toEqual([34, 255, 0, 0]);
    // Slot 127 is not a key: written back exactly as read.
    expect([...sim.table.subarray(127 * 4)]).toEqual([...before.subarray(127 * 4)]);
    expect(sim.effect[0]).toBe(CUSTOM_MODE);
    expect(sim.effect[9]).toBe(5);
    expect((await driver.getPerKeyRgb())[34]).toEqual({ r: 255, g: 0, b: 0 });
    await expect(driver.setPerKeyRgb({ 127: { r: 1, g: 1, b: 1 } })).rejects.toThrow(/not a key/);
  });

  it('through the receiver, changes nothing when it relays another keyboard', async () => {
    const { driver, sim } = await connect(
      new HubSimulator(
        { vendorId: 0x0c45, productId: 0xfef9, productName: '8K Wireless Receiver' },
        { body: [0x1234, 0x5678] },
      ),
    );
    expect(driver.bodyMatches).toBe(false);
    expect(driver.getCapabilities().rgb.write).toBe(false);
    expect(driver.getCapabilities().rgb.note).toMatch(/another keyboard \(1234:5678\)/);
    await expect(driver.setRgbConfig(cfg(2))).rejects.toThrow();
    expect(sim.writes).toEqual([]);
  });

  it('leaves lighting alone on a board that does not answer the lighting read (AK680 MAX, 32-byte reports)', async () => {
    const { driver } = await connect(
      new HubSimulator(
        { vendorId: 0x0c45, productId: 0x80b2, productName: 'AK680 MAX' },
        { reportSize: 32, lighting: false, body: [0x0c45, 0x80b2] },
      ),
    );
    expect(driver.info?.productId).toBe(0x80b2);
    expect(driver.lighting).toBe(false);
    expect(driver.getCapabilities().rgb.write).toBe(false);
  }, 10000);

  it('enables lighting on the AK680 V2 when it answers, without per-key colours', async () => {
    const { driver } = await connect(
      new HubSimulator(
        { vendorId: 0x0c45, productId: 0x80bc, productName: 'AK680 V2' },
        { body: [0x0c45, 0x80bc] },
      ),
    );
    expect(driver.getCapabilities().rgb.write).toBe(true);
    expect(driver.getCapabilities().perKeyRgb.write).toBe(false);
    expect(driver.getRgbEffects().customEffect).toBeUndefined();
  });
});

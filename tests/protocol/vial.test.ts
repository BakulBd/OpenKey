import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { createDefaultRegistry, openDriver, via } from '@openkey/protocols';

const { ViaSimulator, decompressXz, XzError } = via;

/**
 * A synthetic vial.json ({"name": "OpenKey Vial test pad", 2 × 3 matrix}) compressed by Python's
 * lzma.compress, as the Vial build does. Our own content: no keyboard's definition is copied.
 */
const DEFINITION = Uint8Array.from(
  atob(
    '/Td6WFoAAATm1rRGAgAhARYAAAB0L+Wj4ACMAHJdAD2IicZUNsMXT+KeV7kbNfhzpHY5yYmiDuVlihtgjF9hqODFfFcthCUUt/BlS/bpNPWhbwg0bRGh0al+h72Y0jpXG2UCgydOxvdjPO0AgQI/OF9cX4mMI4Kr7Ksz5UBC+zVetEktnddyFG51tsDIlv88QQAAAPAmSzjVZMkNAAGOAY0BAAAUjH7EscRn+wIAAAAABFla',
  ),
  (c) => c.charCodeAt(0),
);

async function connect(sim: InstanceType<typeof ViaSimulator>) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
  });
  return kb.driver as InstanceType<typeof via.ViaDriver>;
}

describe('XZ decoder', () => {
  it('unpacks what Python lzma.compress produced', () => {
    const json = JSON.parse(new TextDecoder().decode(decompressXz(DEFINITION))) as {
      name: string;
    };
    expect(json.name).toBe('OpenKey Vial test pad');
  });

  it('rejects other data, truncation and oversized output', () => {
    expect(() => decompressXz(new Uint8Array(40))).toThrow(XzError);
    expect(() => decompressXz(DEFINITION.subarray(0, 60))).toThrow(XzError);
    expect(() => decompressXz(DEFINITION, 16)).toThrow(/larger than/);
  });
});

describe('Vial (keyboard-stored definition)', () => {
  it('reads the layout from the keyboard with read-only Vial commands', async () => {
    const sim = new ViaSimulator({ rows: 2, cols: 3, vial: { definition: DEFINITION } });
    const driver = await connect(sim);
    expect(driver.needsDefinition).toBe(true);
    sim.commands.length = 0;
    const def = await driver.readVialDefinition();
    expect(def).toMatchObject({
      name: 'OpenKey Vial test pad',
      rows: 2,
      cols: 3,
      vendorId: 0xfeed,
    });
    expect(def.layout.keys.map((k) => k.id)).toEqual(['r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c2']);
    expect(driver.vial).toMatchObject({ protocol: 6, uid: '0102030405060708' });
    // Only FE commands were sent for it.
    expect(new Set(sim.commands)).toEqual(new Set([0xfe]));
  });

  it('reads it at connect time when the USB serial marks a Vial board', async () => {
    const sim = new ViaSimulator({
      rows: 2,
      cols: 3,
      identity: {
        vendorId: 0xfeed,
        productId: 0x0002,
        productName: 'Vial pad',
        serialNumber: 'vial:f64c2b3c:0001',
      },
      vial: { definition: DEFINITION },
    });
    const driver = await connect(sim);
    expect(driver.needsDefinition).toBe(false);
    expect(driver.definition?.name).toBe('OpenKey Vial test pad');
  });

  it('says so when the firmware is plain VIA', async () => {
    const driver = await connect(new ViaSimulator());
    await expect(driver.readVialDefinition()).rejects.toThrow(/does not run Vial/);
  });

  it('never sends the settings reset, unlock, lock or Vial encoder commands', async () => {
    const sim = new ViaSimulator({ vial: { definition: DEFINITION } });
    const driver = await connect(sim);
    const session = (driver as unknown as { session: InstanceType<typeof via.ViaSession> }).session;
    for (const sub of Object.values(via.VIAL_FORBIDDEN)) {
      await expect(session.vialRead([0xfe, sub])).rejects.toThrow(/not one OpenKey sends/);
      await expect(session.vialWrite([0xfe, sub])).rejects.toThrow(/not one OpenKey sends/);
    }
    // Writes cannot go through the read path, and reads cannot write.
    await expect(session.vialRead([0xfe, 0x0b, 7, 0, 1, 0])).rejects.toThrow(/not one OpenKey/);
    await expect(session.vialWrite([0xfe, 0x0d, 0x01, 0])).rejects.toThrow(/not one OpenKey/);
  });
});

describe('Vial extras: QMK settings, tap dance, combos, key overrides', () => {
  async function vialBoard() {
    const sim = new ViaSimulator({
      rows: 2,
      cols: 3,
      vial: {
        definition: DEFINITION,
        settings: { 7: [2, 200], 21: [4, 0], 3: [1, 0] },
        tapDance: 2,
        combos: 2,
        keyOverrides: 1,
      },
    });
    const store = new MemoryStateStore();
    const registry = createDefaultRegistry();
    const open = async () => {
      const group = sim.device.group();
      const detection = await registry.detect(group, { level: 'handshake' });
      return (await openDriver(group, detection, { registry, log: new PacketLog(), store }))
        .driver as InstanceType<typeof via.ViaDriver>;
    };
    const first = await open();
    await first.setDefinition(await first.readVialDefinition());
    return { sim, driver: await open() };
  }

  it('finds the extras on the next connection and offers them as capabilities', async () => {
    const { driver } = await vialBoard();
    expect(driver.vialFeatures?.counts).toMatchObject({ tapDance: 2, combos: 2, keyOverrides: 1 });
    const caps = driver.getCapabilities();
    expect(caps.firmwareSettings.write).toBe(true);
    expect(caps.advancedKeys.write).toBe(true);
    expect(driver.getSpecialActions().filter((x) => x.label.startsWith('Tap dance'))).toHaveLength(
      2,
    );
  });

  it('reads and writes QMK settings little-endian, with read-back', async () => {
    const { driver, sim } = await vialBoard();
    expect(await driver.readQmkSettings()).toEqual({ 7: 200, 21: 0, 3: 0 });
    await driver.writeQmkSettings({ 7: 300, 21: 0b10 });
    expect(await driver.readQmkSettings()).toMatchObject({ 7: 300, 21: 2 });
    expect(sim.vialCommands.some(([sub]) => sub === 0x0c)).toBe(false);
  });

  it('writes tap dances, combos and key overrides and reads them back', async () => {
    const { driver } = await vialBoard();
    const td = { onTap: 0x04, onHold: 0xe0, onDoubleTap: 0x29, onTapHold: 0, tappingTerm: 220 };
    await driver.writeVialEntry('tapDance', 1, td);
    expect((await driver.readTapDances())[1]).toEqual(td);
    const combo = { input: [0x07, 0x09, 0, 0] as [number, number, number, number], output: 0x29 };
    await driver.writeVialEntry('combo', 0, combo);
    expect((await driver.readCombos())[0]).toEqual(combo);
    const ko = {
      trigger: 0x2a,
      replacement: 0x4c,
      layers: 0xffff,
      triggerMods: 0x02,
      negativeModMask: 0,
      suppressedMods: 0x02,
      options: via.KEY_OVERRIDE_ENABLED | 0x07,
    };
    await driver.writeVialEntry('keyOverride', 0, ko);
    expect((await driver.readKeyOverrides())[0]).toEqual(ko);
    await expect(driver.writeVialEntry('combo', 5, combo)).rejects.toThrow(/refused/);
  });
});

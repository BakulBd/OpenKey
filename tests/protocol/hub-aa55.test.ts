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

  describe('knob ring and side bars (F87S)', () => {
    it('reads each zone’s colour from the keyboard', async () => {
      const { driver } = await connect();
      const c = driver.getCapabilities().lightZones;
      expect([c.read, c.write, c.value]).toEqual(['device', true, 'Knob ring, Side light bars']);
      expect(await driver.getLightZones()).toEqual([
        { id: 'ring', name: 'Knob ring', color: { r: 0x40, g: 0x40, b: 0x40 } },
        { id: 'side', name: 'Side light bars', color: { r: 0x80, g: 0x80, b: 0x80 } },
      ]);
    });

    it('changes only the colour bytes of the block it read, then reads it again', async () => {
      const { driver, sim } = await connect();
      const before = sim.zones.get(0x1b)!.slice();
      await driver.setLightZones([{ id: 'ring', color: { r: 1, g: 2, b: 3 } }]);
      const w = sim.writes.find((x) => x.cmd === 0x2b)!;
      expect([...w.data]).toEqual([before[0], 1, 2, 3, ...before.subarray(4)]);
      expect(sim.writes.some((x) => x.cmd === 0x2d)).toBe(false);
      expect((await driver.getLightZones())[0]!.color).toEqual({ r: 1, g: 2, b: 3 });
    });

    it('offers no zones on a keyboard without them, or through a receiver paired elsewhere', async () => {
      const sim = new HubSimulator();
      sim.hasZones = false;
      const { driver } = await connect(sim);
      expect(driver.getCapabilities().lightZones.write).toBe(false);
      await expect(
        driver.setLightZones([{ id: 'ring', color: { r: 0, g: 0, b: 0 } }]),
      ).rejects.toThrow(/not available/);
      const other = new HubSimulator(
        { vendorId: 0x0c45, productId: 0xfef9, productName: '2.4G Receiver' },
        { body: [0x1234, 0x5678] },
      );
      expect((await connect(other)).driver.getCapabilities().lightZones.write).toBe(false);
    });
  });

  describe('key maps (AJAZZ web driver: 0x12/0x22, Fn 0x16/0x26)', () => {
    it('reads the F87S layer, changes keys, writes the table whole and reads it back', async () => {
      const { driver, sim } = await connect();
      expect(driver.getCapabilities().keymap).toMatchObject({ read: 'device', write: true });
      expect(driver.getLayerIds()).toEqual(['base', 'fn']);
      const km = await driver.getKeymap('base');
      expect(km.slots[34]).toEqual({ kind: 'default' }); // W
      await driver.setKeymap({
        layer: 'base',
        slots: {
          34: { kind: 'keyboard', usage: 0x1a, modifiers: 0 },
          48: { kind: 'consumer', usage: 0xe9 },
          32: { kind: 'mouse', action: 'wheel-down' },
          33: { kind: 'mouse', action: 'back' },
        },
        provenance: 'device',
      });
      const t = sim.keyTables.get(0x12)!;
      expect([...t.subarray(34 * 4, 35 * 4)]).toEqual([2, 0, 0x1a, 0]);
      expect([...t.subarray(48 * 4, 49 * 4)]).toEqual([3, 0xe9, 0, 0]);
      expect([...t.subarray(32 * 4, 33 * 4)]).toEqual([1, 3, 0xff, 0]);
      expect([...t.subarray(33 * 4, 34 * 4)]).toEqual([1, 1, 8, 0]);
      expect((await driver.getKeymap('base')).slots[48]).toEqual({ kind: 'consumer', usage: 0xe9 });
      // Fn layer: its own table.
      await driver.setKeymap({
        layer: 'fn',
        slots: { 1: { kind: 'consumer', usage: 0xcd } },
        provenance: 'device',
      });
      expect([...sim.keyTables.get(0x16)!.subarray(4, 8)]).toEqual([3, 0xcd, 0, 0]);
      // Restore defaults: every key back to its factory entry.
      await driver.restoreDefaults('keymap');
      expect(t.subarray(0, 128 * 4).every((b) => b === 0)).toBe(true);
    });

    it('keeps the Fn key and reports a keyboard that ignored the write', async () => {
      const sim = new HubSimulator();
      const { driver } = await connect(sim);
      expect(driver.getLayout().keys.find((k) => k.id === 'Fn')!.slot).toBe(-1);
      await expect(
        driver.setKeymap({
          layer: 'base',
          slots: { 85: { kind: 'keyboard', usage: 4, modifiers: 0 } },
          provenance: 'device',
        }),
      ).rejects.toThrow(/Fn key/);
      sim.keepsKeys = false;
      await expect(
        driver.setKeymap({
          layer: 'base',
          slots: { 34: { kind: 'keyboard', usage: 4, modifiers: 0 } },
          provenance: 'device',
        }),
      ).rejects.toThrow(/did not keep/);
    });

    it('draws the AK680 as its 65 % board with the web driver’s key numbers, without LEDs', async () => {
      const sim = new HubSimulator(
        { vendorId: 0x0c45, productId: 0x80bc, productName: 'AJAZZ AK680 V2' },
        { body: [0x0c45, 0x80bc], reportSize: 64 },
      );
      const { driver } = await connect(sim);
      const l = driver.getLayout();
      expect(l.keys).toHaveLength(68);
      const at = (id: string) => l.keys.find((k) => k.id === id)!;
      expect([
        at('Esc').slot,
        at('Backspace').slot,
        at('Home').slot,
        at('Del').slot,
        at('PgDn').slot,
      ]).toEqual([0, 92, 104, 106, 108]);
      expect(l.keys.every((k) => k.light === null)).toBe(true);
      expect(driver.getCapabilities().keymap.write).toBe(true);
      expect(driver.getCapabilities().perKeyRgb.write).toBe(false);
    });

    it('writes macros to the macro storage, reads them back and assigns one to a key', async () => {
      const { sim, driver } = await connect();
      expect(driver.getCapabilities().macros.write).toBe(true);
      expect(driver.getKeyActionKinds()).toContain('macro');
      const macro = {
        index: 2,
        events: [
          { type: 'key' as const, usage: 0x04, down: true },
          { type: 'delay' as const, ms: 30 },
          { type: 'key' as const, usage: 0x04, down: false },
        ],
      };
      await driver.setMacros([macro]);
      // Index without the last flag, then the block at offset 400.
      expect(new DataView(sim.macros.buffer).getUint32(2 * 4, true)).toBe(400);
      expect([...sim.macros.subarray(400, 412)]).toEqual([4, 0, 0, 0, 30, 0, 4, 0xb0, 0, 0, 4, 0x30]);
      expect(await driver.getMacros()).toEqual([macro]);
      const a = driver.getLayout().keys.find((k) => k.label === 'A')!;
      await driver.setKeymap({
        layer: 'base',
        slots: { [a.slot]: { kind: 'macro', index: 2, mode: 'once', repeat: 0 } },
        provenance: 'device',
      });
      expect((await driver.getKeymap('base')).slots[a.slot]).toEqual({
        kind: 'macro',
        index: 2,
        mode: 'once',
        repeat: 0,
      });
      await driver.restoreDefaults('macros');
      expect(await driver.getMacros()).toEqual([]);
    });

    it('offers no macros on a board without macro storage', async () => {
      const { driver } = await connect(new HubSimulator(undefined, { macroSpace: 0 }));
      expect(driver.getCapabilities().macros.write).toBe(false);
      expect(driver.getKeyActionKinds()).not.toContain('macro');
    });

    it('never builds a reset, firmware, calibration or serial-number request', () => {
      for (const cmd of [0x0f, 0x4f, 0x64, 0x65, 0x80, 0x82, 0x86])
        expect(() => requests(cmd, new Uint8Array(4), 64)).toThrow(/not sent/);
    });
  });

  describe('boards from AJAZZ’s own web driver', () => {
    const ak820 = () =>
      new HubSimulator(
        { vendorId: 0x0c45, productId: 0x8070, productName: 'AK820MAX' },
        // On FF68 the online-driver adapter (sonix-aa55) takes it; the hub drives FF60 boards.
        { body: [0x0c45, 0x8070], reportSize: 64, page: 0xff60 },
      );

    it('recognises a web-driver board by USB identity and product name, with its own rows', async () => {
      const { driver, detection } = await connect(ak820());
      expect(detection.selected?.protocolId).toBe('hub-aa55');
      expect(driver.model.name).toBe('AK820MAX (AULA/AJAZZ web-driver board)');
      const l = driver.getLayout();
      expect(l.keys).toHaveLength(81);
      expect(l.keys.find((k) => k.label === 'Esc')).toMatchObject({
        slot: 0,
        light: 0,
        x: 0,
        y: 0,
      });
      expect(l.keys.find((k) => k.label === 'Fn')!.slot).toBe(-1);
      const caps = driver.getCapabilities();
      expect([caps.keymap.write, caps.fnLayer.write, caps.perKeyRgb.write]).toEqual([
        true,
        true,
        true,
      ]);
      expect(caps.perKeyRgb.note).toMatch(/not confirmed on this board/);
    });

    it('writes a key on a web-driver board and reads it back', async () => {
      const sim = ak820();
      const { driver } = await connect(sim);
      const caps = driver.getLayout().keys.find((k) => k.label === 'Caps')!;
      await driver.setKeymap({
        layer: 'base',
        slots: { [caps.slot]: { kind: 'keyboard', usage: 0xe0, modifiers: 0 } },
        provenance: 'device',
      });
      expect([...sim.keyTables.get(0x12)!.subarray(caps.slot * 4, caps.slot * 4 + 4)]).toEqual([
        2, 0, 0xe0, 0,
      ]);
    });

    it('leaves a web-driver board on an FF68 command pipe to the online-driver adapter', async () => {
      const sim = new HubSimulator(
        { vendorId: 0x0c45, productId: 0x8070, productName: 'AK820MAX' },
        { body: [0x0c45, 0x8070] },
      );
      const detection = await createDefaultRegistry().detect(sim.device.group(), {
        level: 'passive',
      });
      expect(detection.candidates.find((c) => c.protocol.id === 'hub-aa55')?.match.applicable).toBe(
        false,
      );
    });

    it('lays out every web-driver board without overlapping keys', async () => {
      const mod = await import('../../packages/protocols/src/families/hub-aa55/web-boards.json', {
        with: { type: 'json' },
      });
      for (const b of mod.default as hubAa55.WebBoard[]) {
        const l = hubAa55.webLayout('x', b.name, b);
        expect(l.keys, b.name).toHaveLength(b.rows.flat().length);
        for (const a of l.keys)
          for (const c of l.keys)
            if (a !== c)
              expect(
                a.x < c.x + c.w - 0.01 &&
                  c.x < a.x + a.w - 0.01 &&
                  a.y < c.y + c.h - 0.01 &&
                  c.y < a.y + a.h - 0.01,
                `${b.name}: ${a.label} / ${c.label}`,
              ).toBe(false);
      }
    });

    it('does not take a board the web driver does not list', async () => {
      const sim = new HubSimulator(
        { vendorId: 0x0c45, productId: 0x7777, productName: 'Other' },
        { body: [0x0c45, 0x7777] },
      );
      const r = await createDefaultRegistry().detect(sim.device.group(), { level: 'handshake' });
      expect(r.selected?.protocolId).not.toBe('hub-aa55');
    });
  });
});

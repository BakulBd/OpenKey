import { describe, expect, it } from 'vitest';
import {
  Evidence,
  MemoryStateStore,
  PacketLog,
  guardWrites,
  isOpenKeyError,
  writeDecision,
} from '@openkey/core';
import type { KeyAction } from '@openkey/core';
import { createDefaultRegistry, openDriver, via } from '@openkey/protocols';

const { decodeKeycode, encodeKeycode, parseDefinition, ViaSimulator, FORBIDDEN } = via;

async function connect(sim: InstanceType<typeof ViaSimulator>, store = new MemoryStateStore()) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake' });
  const kb = await openDriver(group, detection, { registry, log: new PacketLog(), store });
  return { driver: kb.driver as InstanceType<typeof via.ViaDriver>, store, detection };
}

describe('VIA keycodes', () => {
  const cases: [number, KeyAction][] = [
    [0x0004, { kind: 'keyboard', usage: 0x04, modifiers: 0 }],
    [0x0104, { kind: 'keyboard', usage: 0x04, modifiers: 0x01 }],
    [0x1204, { kind: 'keyboard', usage: 0x04, modifiers: 0x20 }],
    [0x00e1, { kind: 'keyboard', usage: 0xe1, modifiers: 0 }],
    [0x00a8, { kind: 'consumer', usage: 0xe2 }],
    [0x00ae, { kind: 'consumer', usage: 0xcd }],
    [0x00a6, { kind: 'system', usage: 0x82 }],
    [0x00d1, { kind: 'mouse', action: 'left' }],
    [0x5221, { kind: 'layer', layer: 1, mode: 'momentary' }],
    [0x5262, { kind: 'layer', layer: 2, mode: 'toggle' }],
    [0x7703, { kind: 'macro', index: 3, mode: 'once', repeat: 0 }],
    [0x0000, { kind: 'disabled' }],
  ];
  it.each(cases)('v2 0x%s round-trips', (code, action) => {
    expect(decodeKeycode(code, 2)).toEqual(action);
    expect(encodeKeycode(action, 2)).toBe(code);
  });

  it('keeps everything else as an exact special keycode', () => {
    expect(decodeKeycode(0x0001, 2)).toEqual({ kind: 'special', code: 1, label: '▽ Transparent' });
    expect(decodeKeycode(0x4104, 2)).toMatchObject({
      kind: 'special',
      code: 0x4104,
      label: 'LT(1, 0x0004)',
    });
    expect(encodeKeycode(decodeKeycode(0x2204, 2), 2)).toBe(0x2204);
  });

  it('uses the v1 numbering for older firmware', () => {
    expect(decodeKeycode(0x5101, 1)).toEqual({ kind: 'layer', layer: 1, mode: 'momentary' });
    expect(encodeKeycode({ kind: 'layer', layer: 1, mode: 'toggle' }, 1)).toBe(0x5301);
    expect(decodeKeycode(0x00f4, 1)).toEqual({ kind: 'mouse', action: 'left' });
  });

  it('refuses bootloader/erase keycodes and mixed-side modifiers', () => {
    expect(decodeKeycode(0x7c00, 2)).toMatchObject({
      kind: 'special',
      label: 'Bootloader (QK_BOOT)',
    });
    expect(() => encodeKeycode({ kind: 'special', code: 0x7c00 }, 2)).toThrow(/bootloader/);
    expect(() => encodeKeycode({ kind: 'keyboard', usage: 4, modifiers: 0x11 }, 2)).toThrow(
      /left and right/,
    );
    expect(via.offeredSpecials(2).some((s) => s.code === 0x7c03)).toBe(false);
  });
});

describe('VIA definitions', () => {
  it('parses a VIA definition in KLE format with offsets, layout options and decals', () => {
    const d = parseDefinition(
      JSON.stringify({
        name: 'Tiny',
        vendorId: '0xFEED',
        productId: '0x0001',
        matrix: { rows: 2, cols: 3 },
        menus: ['qmk_rgb_matrix'],
        layouts: {
          keymap: [
            ['0,0', { w: 2 }, '0,1', '0,2'],
            [
              { y: 0.5, x: 0.25 },
              '1,0',
              '1,1\n\n\n\n\n\n\n\n0,0',
              '1,1\n\n\n\n\n\n\n\n0,1',
              { d: true },
              '1,2',
            ],
          ],
        },
      }),
    );
    expect(d).toMatchObject({
      name: 'Tiny',
      vendorId: 0xfeed,
      productId: 1,
      rows: 2,
      cols: 3,
      lighting: 'qmk_rgb_matrix',
      format: 'via',
    });
    const k = Object.fromEntries(d.layout.keys.map((x) => [x.id, x]));
    expect(Object.keys(k).sort()).toEqual(['r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c1']);
    expect(k.r0c1).toMatchObject({ x: 1, w: 2, slot: 1 });
    expect(k.r0c2).toMatchObject({ x: 3 });
    expect(k.r1c0).toMatchObject({ x: 0.25, y: 1.5, slot: 3 });
  });

  it('parses a QMK info.json', () => {
    const d = parseDefinition(
      JSON.stringify({
        keyboard_name: 'Macro pad',
        usb: { vid: '0x1234', pid: '0x0002' },
        layouts: {
          LAYOUT: {
            layout: [
              { matrix: [0, 0], x: 0, y: 0 },
              { matrix: [0, 1], x: 1, y: 0, w: 2 },
              { matrix: [1, 0], x: 0, y: 1 },
            ],
          },
        },
      }),
    );
    expect(d).toMatchObject({ rows: 2, cols: 2, format: 'qmk', vendorId: 0x1234 });
    expect(d.layout.keys.map((x) => x.slot)).toEqual([0, 1, 2]);
  });

  it('explains what is wrong with other files', () => {
    expect(() => parseDefinition('nope')).toThrow(/not valid JSON/);
    expect(() => parseDefinition('{"foo":1}')).toThrow(/Not a VIA definition/);
    expect(() =>
      parseDefinition('{"matrix":{"rows":99,"cols":2},"layouts":{"keymap":[]}}'),
    ).toThrow(/1–32/);
  });
});

describe('VIA driver (firmware simulator)', () => {
  it('identifies, then asks for a definition before editing the keymap', async () => {
    const { driver, detection } = await connect(new ViaSimulator());
    expect(detection.selected).toMatchObject({
      protocolId: 'qmk-via',
      identification: 'identified',
    });
    expect(driver.needsDefinition).toBe(true);
    expect(driver.getLayerIds()).toEqual(['base', 'fn', 'layer2', 'layer3']);
    await expect(driver.getKeymap('base')).rejects.toThrow(/definition/);
  });

  it('reads and writes the keymap of any layer, changing only the edited keys, with read-back', async () => {
    const sim = new ViaSimulator();
    const first = await connect(sim);
    await first.driver.useGrid(5, 15);
    expect(first.driver.needsDefinition).toBe(true); // applies from the next connection
    const { driver } = await connect(sim, first.store);
    const base = await driver.getKeymap('base');
    expect(base.provenance).toBe('device');
    expect(base.slots[0]).toEqual({ kind: 'keyboard', usage: 0x29, modifiers: 0 });
    const l2 = await driver.getKeymap('layer2');
    expect(l2.slots[5]).toMatchObject({ kind: 'special', code: 1 });
    sim.commands.length = 0;
    await driver.setKeymap({ ...l2, slots: { ...l2.slots, 5: { kind: 'consumer', usage: 0xe9 } } });
    expect(sim.code(2, 0, 5)).toBe(0x00a9);
    expect(sim.commands.filter((c) => c === 0x05)).toHaveLength(1);
  });

  it('remembers the definition per keyboard model', async () => {
    const sim = new ViaSimulator();
    const first = await connect(sim);
    await first.driver.useGrid(5, 15);
    const again = await connect(sim, first.store);
    expect(again.driver.needsDefinition).toBe(false);
    expect(again.driver.getLayout().keys).toHaveLength(75);
  });

  it('reads, writes and saves lighting on the channel the firmware has', async () => {
    const sim = new ViaSimulator();
    const { driver } = await connect(sim);
    expect(driver.getCapabilities().rgb.value).toBe('QMK RGB matrix');
    const cfg = await driver.getRgbConfig();
    expect(cfg).toMatchObject({ effect: 1, brightness: 180, speed: 128 });
    await driver.setRgbConfig({ ...cfg, effect: 5, brightness: 90, color: { r: 255, g: 0, b: 0 } });
    expect(sim.lighting.get(2)).toEqual([5, 0]);
    expect(sim.lighting.get(4)?.[1]).toBe(255);
    expect(sim.saved).toBe(1);
  });

  it('reports no lighting when no channel answers', async () => {
    const { driver } = await connect(new ViaSimulator({ channel: null }));
    expect(driver.getCapabilities().rgb.write).toBe(false);
  });

  it('round-trips macros through the VIA buffer, including typed text from other tools', async () => {
    const sim = new ViaSimulator();
    const { driver } = await connect(sim);
    const m = {
      index: 1,
      events: [
        { type: 'key', usage: 0x04, down: true },
        { type: 'delay', ms: 50 },
        { type: 'key', usage: 0x04, down: false },
      ],
    } as const;
    await driver.setMacros([{ ...m, events: [...m.events] }]);
    const back = await driver.getMacros();
    expect(back[1]!.events).toEqual(m.events);
    expect(back[0]!.events).toEqual([]);
    // "Hi" stored as text by another tool decodes to shift + h, i.
    sim.macros.set([0x48, 0x69, 0x00]);
    expect(
      (await driver.getMacros())[0]!.events.map((e) =>
        e.type === 'key' ? `${e.down ? '+' : '-'}${e.usage.toString(16)}` : '',
      ),
    ).toEqual(['+e1', '+b', '-b', '-e1', '+c', '-c']);
  });

  it('never sends reset, EEPROM-reset, macro-reset or bootloader commands', async () => {
    const sim = new ViaSimulator();
    const first = await connect(sim);
    await first.driver.useGrid(5, 15);
    const { driver } = await connect(sim, first.store);
    await driver.getKeymap('base');
    await driver.getMacros();
    await driver.getRgbConfig();
    for (const id of Object.values(FORBIDDEN)) expect(sim.commands).not.toContain(id);
    const s = new via.ViaSession(
      await sim.device.group().openInterface(sim.device.group().interfaces[0]!),
    );
    await expect(s.command([FORBIDDEN.BOOTLOADER_JUMP])).rejects.toThrow(/never sends/);
  });

  it('keeps VIA writes behind the experimental opt-in until verified on hardware', async () => {
    const sim = new ViaSimulator();
    const first = await connect(sim);
    await first.driver.useGrid(5, 15);
    const { driver } = await connect(sim, first.store);
    const caps = driver.getCapabilities();
    expect(caps.keymap.confidence).toBe(Evidence.OBSERVED);
    expect(writeDecision(caps.keymap, { simulated: false, experimentalEnabled: false }).kind).toBe(
      'experimental',
    );
    const g = guardWrites(driver, () => ({ simulated: false, experimentalEnabled: false }));
    await expect(g.setKeymap(await driver.getKeymap('base'))).rejects.toSatisfy(
      (e) => isOpenKeyError(e) && e.code === 'SAFETY_BLOCKED',
    );
  });
});

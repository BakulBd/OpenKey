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
  it('asks before querying an identity the catalogue assigns to vendor firmware', async () => {
    // A QMK-flashed AK820 Pro keeps 0C45:8009, so VIA stays possible, but stock firmware reuses
    // FF60:0061 too: nothing is sent until the user allows the VIA query.
    const sim = new ViaSimulator({
      identity: { vendorId: 0x0c45, productId: 0x8009, productName: 'AK820 MAX' },
    });
    const registry = createDefaultRegistry();
    const asked = await registry.detect(sim.device.group(), { level: 'handshake' });
    const cand = asked.candidates.find((c) => c.protocol.id === 'qmk-via')!;
    expect(cand.consent).toMatchObject({ required: true, granted: false });
    expect(sim.commands).toEqual([]);
    const allowed = await registry.detect(sim.device.group(), {
      level: 'handshake',
      consent: ['qmk-via'],
    });
    expect(allowed.selected).toMatchObject({ protocolId: 'qmk-via', identification: 'identified' });
  });

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

describe('VIA compiled definitions (usevia.app format)', () => {
  it('parses resolved keys, skips decals, and derives the USB identity', () => {
    const d = via.parseDefinition(
      JSON.stringify({
        name: 'Compiled',
        vendorProductId: (0x3434 << 16) | 0x0100,
        matrix: { rows: 2, cols: 2 },
        menus: ['qmk_rgb_matrix'],
        layouts: {
          width: 3,
          height: 2,
          optionKeys: {},
          keys: [
            { row: 0, col: 0, x: 0, y: 0, w: 1, h: 1, d: false },
            { row: 0, col: 1, x: 1, y: 0, w: 2, h: 1, d: false },
            { row: 1, col: 0, x: 0, y: 1, w: 1, h: 1, d: true },
            { row: 1, col: 1, x: 1, y: 1, w: 1, h: 1, d: false },
          ],
        },
      }),
    );
    expect(d).toMatchObject({
      vendorId: 0x3434,
      productId: 0x0100,
      rows: 2,
      cols: 2,
      lighting: 'qmk_rgb_matrix',
    });
    expect(d.layout.keys.map((k) => k.slot)).toEqual([0, 1, 3]);
  });

  it('builds the usevia.app URLs from the USB identity, v3 first', () => {
    expect(via.viaDefinitionUrls(0x3434, 0x0100)).toEqual([
      'https://usevia.app/definitions/v3/875823360.json',
      'https://usevia.app/definitions/v2/875823360.json',
    ]);
  });

  it('adds the default choice of every layout option (they are not in keys)', () => {
    // Shaped like a compiled definition with an ISO Enter option, as usevia.app serves it.
    const d = parseDefinition(
      JSON.stringify({
        name: 'Options',
        vendorProductId: (0xfeed << 16) | 2,
        matrix: { rows: 2, cols: 3 },
        layouts: {
          labels: ['ISO Enter', ['Bottom row', 'ANSI', 'Tsangan', 'WKL']],
          optionKeys: {
            0: {
              0: [{ row: 0, col: 2, x: 2, y: 0, w: 1.5, h: 1 }],
              1: [{ row: 0, col: 2, x: 2.25, y: 0, w: 1.25, h: 2 }],
            },
            1: {
              0: [{ row: 1, col: 1, x: 1, y: 1, w: 1, h: 1 }],
              1: [{ row: 1, col: 1, x: 1, y: 1, w: 1.5, h: 1 }],
              2: [],
            },
          },
          keys: [
            { row: 0, col: 0, x: 0, y: 0 },
            { row: 0, col: 1, x: 1, y: 0 },
            { row: 1, col: 0, x: 0, y: 1 },
          ],
        },
      }),
    );
    expect(d.layout.keys.map((k) => k.id).sort()).toEqual(['r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c1']);
    expect(d.options).toEqual([
      { label: 'ISO Enter', choices: ['Off', 'On'] },
      { label: 'Bottom row', choices: ['ANSI', 'Tsangan', 'WKL'] },
    ]);
    const iso = via.withLayoutOptions(d, [1, 2]);
    expect(iso.choices).toEqual([1, 2]);
    const enter = iso.layout.keys.find((k) => k.id === 'r0c2')!;
    expect(enter).toMatchObject({ h: 2, w: 1.25 });
    expect(iso.layout.keys.some((k) => k.id === 'r1c1')).toBe(false); // WKL: no key there
    // Back to the defaults: the same keys as the first parse.
    expect(via.withLayoutOptions(iso, []).layout.keys).toEqual(d.layout.keys);
  });

  it('moves a KLE option choice drawn elsewhere onto the default choice', () => {
    const d = parseDefinition(
      JSON.stringify({
        name: 'KLE options',
        vendorId: '0xFEED',
        productId: '0x0003',
        matrix: { rows: 1, cols: 3 },
        layouts: {
          labels: ['Split Backspace'],
          keymap: [
            [
              '0,0',
              { w: 2 },
              // As VIA source files write it: the option on the fourth line (alignment 0).
              '0,1\n\n\n0,0',
              { x: 1 },
              '0,1\n\n\n0,1',
              '0,2\n\n\n0,1',
            ],
          ],
        },
      }),
    );
    expect(d.layout.keys.map((k) => k.id)).toEqual(['r0c0', 'r0c1']);
    expect(d.layout.keys[1]).toMatchObject({ x: 1, w: 2 });
    const split = via.withLayoutOptions(d, [1]);
    expect(split.layout.keys.map((k) => [k.id, k.x])).toEqual([
      ['r0c0', 0],
      ['r0c1', 1],
      ['r0c2', 2],
    ]);
  });

  it('reads encoders from KLE the way VIA source files mark them (tenth line, "e0")', () => {
    const d = parseDefinition(
      JSON.stringify({
        name: 'KLE knob',
        vendorId: '0xFEED',
        productId: '0x0005',
        matrix: { rows: 1, cols: 2 },
        layouts: { keymap: [['0,0', '0,1\n\n\n\n\n\n\n\n\ne0']] },
      }),
    );
    expect(d.encoders).toBe(1);
    expect(d.layout.keys.map((k) => k.id)).toEqual(['r0c0', 'e0ccw', 'r0c1', 'e0cw']);
  });

  it('draws knobs as ↺ / press / ↻ keys and remembers the encoder count', () => {
    const d = parseDefinition(
      JSON.stringify({
        name: 'Knob',
        vendorProductId: (0xfeed << 16) | 4,
        matrix: { rows: 1, cols: 2 },
        layouts: {
          keys: [
            { row: 0, col: 0, x: 0, y: 0 },
            { ei: 0, row: 0, col: 1, x: 1, y: 0, w: 1.5 },
            { ei: 1, x: 3, y: 0 },
          ],
        },
      }),
    );
    expect(d.encoders).toBe(2);
    expect(d.layout.keys.map((k) => [k.id, k.slot])).toEqual([
      ['r0c0', 0],
      ['e0ccw', 2],
      ['r0c1', 1],
      ['e0cw', 3],
      ['e1ccw', 4],
      ['e1cw', 5],
    ]);
    expect(via.encoderOfSlot(1, 2, 5)).toEqual({ index: 1, clockwise: true });
  });

  it('packs layout options as VIA does: first option in the highest bits', () => {
    const options = [
      { label: 'ISO Enter', choices: ['Off', 'On'] },
      { label: 'Bottom row', choices: ['ANSI', 'Tsangan', 'WKL'] },
      { label: 'Split Shift', choices: ['Off', 'On'] },
    ];
    // ISO = 1 (1 bit), bottom row = 2 (2 bits), split = 1 (1 bit) → 1 10 1.
    expect(via.packLayoutOptions([1, 2, 1], options)).toBe(0b1101);
    expect(via.unpackLayoutOptions(0b1101, options)).toEqual([1, 2, 1]);
    expect(via.unpackLayoutOptions(0, options)).toEqual([0, 0, 0]);
  });
});

describe('VIA encoders and stored layout options (simulator)', () => {
  const knobDefinition = JSON.stringify({
    name: 'Knob board',
    vendorProductId: (0xfeed << 16) | 0x6060,
    matrix: { rows: 5, cols: 15 },
    layouts: {
      labels: ['Split Backspace'],
      optionKeys: {
        0: {
          0: [{ row: 0, col: 13, x: 13, y: 0, w: 2 }],
          1: [
            { row: 0, col: 13, x: 13, y: 0 },
            { row: 0, col: 14, x: 14, y: 0 },
          ],
        },
      },
      keys: [
        { row: 0, col: 0, x: 0, y: 0 },
        { ei: 0, x: 16, y: 0 },
      ],
    },
  });

  it('reads and writes knob turns on any layer, with read-back', async () => {
    const sim = new ViaSimulator({ encoders: 1 });
    const store = new MemoryStateStore();
    const first = await connect(sim, store);
    await first.driver.setDefinition(parseDefinition(knobDefinition));
    const { driver } = await connect(sim, store);
    expect(driver.getCapabilities().encoder.write).toBe(true);
    const base = await driver.getKeymap('base');
    const cw = via.encoderSlot(5, 15, 0, true);
    expect(base.slots[cw]).toMatchObject({ kind: 'consumer' });
    await driver.setKeymap({
      ...base,
      slots: { ...base.slots, [cw]: { kind: 'keyboard', usage: 0x4f, modifiers: 0 } },
    });
    expect(sim.encoderMap.get('0,0,1')).toBe(0x004f);
    const l2 = await driver.getKeymap('layer2');
    expect(l2.slots[cw]).toMatchObject({ kind: 'consumer' });
  });

  it('applies the layout options stored in the keyboard unless the user chose some', async () => {
    const sim = new ViaSimulator({ layoutOptions: 1 });
    const store = new MemoryStateStore();
    const first = await connect(sim, store);
    await first.driver.setDefinition(parseDefinition(knobDefinition));
    const { driver } = await connect(sim, store);
    expect(driver.definition?.choices).toEqual([1]);
    expect(driver.getLayout().keys.some((k) => k.id === 'r0c14')).toBe(true);
  });
});

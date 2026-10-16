import { describe, expect, it } from 'vitest';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { createDefaultRegistry, openDriver, via } from '@openkey/protocols';

const { parseMenus, evalShowIf, controlBytes, controlNumber } = via;

/** Shaped like the lighting menu a compiled VIA definition carries. */
const MENUS = [
  'qmk_rgb_matrix',
  {
    label: 'Lighting',
    content: [
      {
        label: 'Backlight',
        content: [
          {
            label: 'Brightness',
            type: 'range',
            options: [0, 255],
            content: ['id_brightness', 3, 1],
          },
          {
            label: 'Effect',
            type: 'dropdown',
            content: ['id_effect', 3, 2],
            options: [
              ['None', 0],
              ['Solid', 1],
              ['Breathing', 2],
            ],
          },
          {
            showIf: '{id_effect} > 1',
            label: 'Speed',
            type: 'range',
            options: [0, 255],
            content: ['id_speed', 3, 3],
          },
          {
            showIf: '{id_effect} != 0',
            label: 'Colour',
            type: 'color',
            content: ['id_color', 3, 4],
          },
          {
            showIf: '{id_effect} == 2',
            content: [{ label: 'Wide', type: 'toggle', content: ['id_wide', 3, 9, 1] }],
          },
          { label: 'Tapping term', type: 'range', options: [50, 1000], content: ['id_tt', 0, 7] },
          { label: 'Send', type: 'button', options: [5], content: ['id_btn', 0, 8] },
          { label: 'eval me', type: 'range', content: 'not a command' },
        ],
      },
    ],
  },
];

describe('VIA custom menus', () => {
  const [menu] = parseMenus(MENUS);
  const controls = menu!.sections[0]!.controls;
  const byLabel = (l: string) => controls.find((c) => c.label === l)!;

  it('parses menus, skipping built-in names and malformed controls', () => {
    expect(parseMenus(MENUS)).toHaveLength(1);
    expect(menu!.label).toBe('Lighting');
    expect(controls.map((c) => c.label)).toEqual([
      'Brightness',
      'Effect',
      'Speed',
      'Colour',
      'Wide',
      'Tapping term',
      'Send',
    ]);
    expect(byLabel('Effect').choices).toEqual([
      ['None', 0],
      ['Solid', 1],
      ['Breathing', 2],
    ]);
    // Conditions of enclosing groups are kept.
    expect(byLabel('Wide')).toMatchObject({ showIf: '{id_effect} == 2', command: [3, 9, 1] });
  });

  it('evaluates showIf without eval', () => {
    expect(evalShowIf('{id_effect} > 1', { id_effect: 2 })).toBe(true);
    expect(evalShowIf('{id_effect} > 1', { id_effect: 1 })).toBe(false);
    expect(evalShowIf('({a} == 1 || {b} == 3) && !{c}', { a: 0, b: 3, c: 0 })).toBe(true);
    expect(evalShowIf('{a} + 2 * 3 == 7', { a: 1 })).toBe(true);
    expect(evalShowIf(undefined, {})).toBe(true);
    // Anything outside the grammar shows the control instead of running code.
    expect(evalShowIf('alert(1)', {})).toBe(true);
    expect(evalShowIf('{a} ==', { a: 1 })).toBe(true);
  });

  it('encodes values as VIA does (big-endian above 255, toggles by option bytes)', () => {
    expect(byLabel('Tapping term').bytes).toBe(2);
    expect(controlBytes(byLabel('Tapping term'), 300)).toEqual([0x01, 0x2c]);
    expect(controlNumber(byLabel('Tapping term'), [0x01, 0x2c])).toBe(300);
    expect(controlBytes(byLabel('Brightness'), 200)).toEqual([200]);
    expect(controlBytes(byLabel('Colour'), (170 << 8) | 255)).toEqual([170, 255]);
    expect(controlBytes(byLabel('Wide'), 1)).toEqual([1]);
    expect(controlNumber(byLabel('Wide'), [0])).toBe(0);
    expect(controlBytes(byLabel('Send'), 0)).toEqual([5]);
  });
});

describe('VIA custom menus against the simulator', () => {
  const definition = JSON.stringify({
    name: 'Menu board',
    vendorProductId: (0xfeed << 16) | 0x6060,
    matrix: { rows: 5, cols: 15 },
    menus: [
      {
        label: 'Keyboard',
        content: [
          {
            label: 'Features',
            content: [
              {
                label: 'Knob mode',
                type: 'dropdown',
                options: ['Volume', 'Scroll'],
                content: ['id_knob', 0, 1],
              },
              {
                label: 'Tapping term',
                type: 'range',
                options: [100, 500],
                content: ['id_tt', 0, 2],
              },
              { label: 'Reset stats', type: 'button', content: ['id_reset', 0, 3] },
            ],
          },
        ],
      },
    ],
    layouts: { keys: [{ row: 0, col: 0, x: 0, y: 0 }] },
  });

  async function connect(sim: InstanceType<typeof via.ViaSimulator>, store: MemoryStateStore) {
    const registry = createDefaultRegistry();
    const group = sim.device.group();
    const detection = await registry.detect(group, { level: 'handshake' });
    return (await openDriver(group, detection, { registry, log: new PacketLog(), store }))
      .driver as InstanceType<typeof via.ViaDriver>;
  }

  it('reads, writes, saves per channel and reads back', async () => {
    const custom: Record<string, number[]> = { '0,1': [0], '0,2': [0x00, 0xc8], '0,3': [0] };
    const sim = new via.ViaSimulator({ custom });
    const store = new MemoryStateStore();
    await (await connect(sim, store)).setDefinition(via.parseDefinition(definition));
    const driver = await connect(sim, store);
    expect(driver.getCapabilities().customMenus.write).toBe(true);
    expect(await driver.readMenuValues()).toEqual({ id_knob: [0], id_tt: [0x00, 0xc8] });
    const saved = sim.saved;
    await driver.writeMenuValues({ id_knob: [1], id_tt: [0x01, 0x2c], id_reset: [] });
    expect(custom).toMatchObject({ '0,1': [1], '0,2': [0x01, 0x2c], '0,3': [1] });
    expect(sim.saved - saved).toBe(1);
  });
});

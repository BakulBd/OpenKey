import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Evidence,
  MemoryStateStore,
  PacketLog,
  isDiagnosticsDriver,
  isOpenKeyError,
  writeDecision,
} from '@openkey/core';
import type { Direction } from '@openkey/core';
import { createDefaultRegistry, openDriver, winbond } from '@openkey/protocols';

const { WinbondSimulator, lightingPacket } = winbond;

interface Capture {
  capture: string;
  set: Record<string, number | number[]>;
  packet: string;
}
const CAPTURES = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, '../../fixtures/rgb/mk870-lighting-captures-issue13.json'),
    'utf8',
  ),
) as { reportId: number; captures: Capture[] };
const hexBytes = (h: string) => h.split(' ').map((x) => parseInt(x, 16));
const byCode = (code: number) =>
  Object.entries(winbond.DIRECTION_CODES).find(([, c]) => c === code)![0] as Direction;

async function connect(sim = new WinbondSimulator(), consent: string[] = []) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake', consent });
  // Detection sends nothing: the model is identified from its USB identity and report layout.
  const detectionTraffic = sim.packets.length;
  const kb = await openDriver(group, detection, {
    registry,
    log: new PacketLog(),
    store: new MemoryStateStore(),
    allowExperimental: true,
  });
  // Connecting sends only the official read-only lighting query.
  const onConnect = sim.packets.map((p) => [...p.subarray(0, 2)]);
  sim.packets.length = 0;
  return { sim, detection, detectionTraffic, onConnect, driver: kb.driver };
}

describe('Winbond keyboards (FL Esports MK870)', () => {
  it('builds the packet keyboard-colour captured from the vendor software', () => {
    const p = lightingPacket({
      effect: 0x02,
      color: { r: 255, g: 0, b: 0 },
      color2: { r: 0, g: 0, b: 255 },
      colorful: true,
      brightness: 4,
      speed: 3,
      direction: 'left',
    });
    expect(p).toHaveLength(63);
    expect([...p.subarray(0, 16)]).toEqual([
      0x07, 0, 0, 0, 0x0e, 0x02, 4, 3, 255, 0, 0, 0, 0, 255, 0x01, 0x01,
    ]);
    expect(p.subarray(16).every((b) => b === 0)).toBe(true);
    expect(() => lightingPacket({ ...winbond.DEFAULT_CONFIG, effect: 0x05 })).toThrow(/not one/);
  });

  it('identifies the MK870 from its owner’s descriptors without sending anything', async () => {
    const { detection, driver, detectionTraffic, onConnect } = await connect();
    expect(detection.selected).toMatchObject({
      protocolId: 'winbond-lighting',
      identification: 'identified',
    });
    expect(detectionTraffic).toBe(0);
    // Nothing on connection: the lighting query blanked an owner's lights (issue #13).
    expect(onConnect).toEqual([]);
    expect((await driver.getDeviceInfo()).model).toBe('FL Esports MK870');
    expect(driver.getLayout().keys).toHaveLength(87);
    const caps = driver.getCapabilities();
    expect(caps.rgb.write).toBe(true);
    expect([
      caps.keymap.write,
      caps.perKeyRgb.write,
      caps.macros.write,
      caps.fnLayer.write,
    ]).toEqual([true, true, true, true]);
    expect(driver.getLayerIds()).toEqual(['base', 'fn']);
  });

  it('writes an effect with two colours and a rotating direction, and remembers it', async () => {
    const { driver, sim } = await connect();
    const spiral = driver.getRgbEffects().effects.find((e) => e.name === 'Spiral')!;
    expect(spiral.controls.direction).toEqual(['clockwise', 'anticlockwise']);
    const config = {
      effect: spiral.id,
      color: { r: 1, g: 2, b: 3 },
      color2: { r: 4, g: 5, b: 6 },
      colorful: false,
      brightness: 2,
      speed: 1,
      direction: 'anticlockwise' as const,
    };
    await driver.setRgbConfig(config);
    expect(sim.packets).toHaveLength(1);
    expect([...sim.packets[0]!.subarray(0, 16)]).toEqual([
      0x07, 0, 0, 0, 0x0e, 0x04, 2, 1, 1, 2, 3, 4, 5, 6, 0x07, 0,
    ]);
    expect(await driver.getRgbConfig()).toEqual(config);
  });

  it('gives an effect a direction it offers', async () => {
    const { driver, sim } = await connect();
    await driver.setRgbConfig({ ...winbond.DEFAULT_CONFIG, effect: 0x0f, direction: 'left' });
    expect(sim.packets[0]![14]).toBe(winbond.DIRECTION_CODES.clockwise);
  });

  it('asks before using another Winbond "Gaming Keyboard", and ignores other products', async () => {
    const other = new WinbondSimulator({
      vendorId: 0x0416,
      productId: 0xc999,
      productName: 'Gaming Keyboard',
    });
    const plan = winbond.winbondProtocol.probePlan;
    expect(plan.autoConsent?.(other.device.group()).auto).toBe(false);
    const { driver } = await connect(other, ['winbond-lighting']);
    expect((await driver.getDeviceInfo()).model).toBe('Winbond gaming keyboard');

    const stranger = new WinbondSimulator({
      vendorId: 0x0416,
      productId: 0x1234,
      productName: 'Something else',
    });
    const report = await createDefaultRegistry().detect(stranger.device.group());
    expect(report.selected).toBeNull();
  });

  it('refuses an unknown effect', async () => {
    const { driver, sim } = await connect();
    await expect(
      driver.setRgbConfig({ ...winbond.DEFAULT_CONFIG, effect: 0x05 }),
    ).rejects.toSatisfy((e) => isOpenKeyError(e));
    expect(sim.packets).toEqual([]);
  });

  it('numbers keys and LEDs by the official driver’s 6 × 22 matrix', async () => {
    const { driver } = await connect();
    const key = (id: string) => driver.getLayout().keys.find((k) => k.id === id)!;
    expect(key('Esc')).toMatchObject({ slot: 0, light: 0 });
    expect(key('W')).toMatchObject({ slot: 46, light: 46 });
    expect(key('\\')).toMatchObject({ slot: 58, light: 58 });
    expect(key('Right')).toMatchObject({ slot: 127, light: 127 });
    // The Fn key lights up but cannot be remapped.
    expect(key('Fn')).toMatchObject({ slot: -1, light: 121 });
  });

  it('writes per-key colours in eight packets, scaled to the vendor range, then shows them', async () => {
    const { driver, sim } = await connect();
    await driver.setPerKeyRgb({ 0: { r: 255, g: 0, b: 128 }, 127: { r: 0, g: 255, b: 0 } });
    const perKey = sim.packets.filter((p) => p[0] === winbond.PER_KEY_CMD);
    expect(perKey).toHaveLength(8);
    expect([...perKey[0]!.subarray(0, 8)]).toEqual([0x09, 0, 0, 0, 0x36, 0xc1, 0x00, 0x61]);
    // LED 127 is the second LED of packet 7 (126–131), which carries 6 LEDs.
    expect([...perKey[7]!.subarray(0, 5)]).toEqual([0x09, 0, 0, 7, 0x12]);
    expect([...perKey[7]!.subarray(8, 11)]).toEqual([0x00, 0xc1, 0x00]);
    const last = sim.packets.at(-1)!;
    expect([last[0], last[5]]).toEqual([0x07, winbond.CUSTOM_EFFECT]);
    expect(await driver.getPerKeyRgb()).toEqual({
      0: { r: 255, g: 0, b: 128 },
      127: { r: 0, g: 255, b: 0 },
    });
  });

  it('writes the default layer as the official driver does, with the Fn key kept', async () => {
    const { driver, sim } = await connect();
    // Caps Lock (slot 66) becomes Left Ctrl; F1 (slot 2) is disabled.
    await driver.setKeymap({
      layer: 'base',
      slots: { 66: { kind: 'keyboard', usage: 0xe0, modifiers: 0 }, 2: { kind: 'disabled' } },
      provenance: 'mirror',
    });
    const maps = sim.packets.filter((p) => p[0] === winbond.KEYMAP_CMD);
    expect(maps).toHaveLength(10);
    expect([...maps[0]!.subarray(0, 5)]).toEqual([0x18, 0, 0, 0, 56]);
    expect([...maps[0]!.subarray(5, 9)]).toEqual([0x00, 0x29, 0x00, 0x00]); // Esc, default
    expect([...maps[0]!.subarray(13, 17)]).toEqual([0, 0, 0, 0]); // F1, disabled
    // Slot 66 is the 10th key of packet 4 (56–69).
    expect([...maps[4]!.subarray(5 + 10 * 4, 5 + 11 * 4)]).toEqual([0x00, 0xe0, 0x00, 0x00]);
    // Slot 121 (Fn) is the 9th key of packet 8 (112–125).
    expect([...maps[8]!.subarray(5 + 9 * 4, 5 + 10 * 4)]).toEqual([0x01, 0x00, 0x00, 0x00]);
    expect([...maps[9]!.subarray(0, 5)]).toEqual([0x18, 0, 0, 9, 24]);
    expect((await driver.getKeymap('base')).slots[66]).toEqual({
      kind: 'keyboard',
      usage: 0xe0,
      modifiers: 0,
    });
  });

  it('encodes media keys and keys with modifiers as the official driver does', async () => {
    const { driver, sim } = await connect();
    expect(driver.getKeyActionKinds()).toContain('special');
    expect(driver.getSpecialActions().map((a) => a.label)).toContain('Calculator');
    await driver.setKeymap({
      layer: 'base',
      slots: {
        // F12 → volume up; F1 → Win+Tab; F2 → Ctrl+Shift+Esc.
        14: { kind: 'special', code: 0x10, label: 'Volume up' },
        2: { kind: 'keyboard', usage: 0x2b, modifiers: 0x08 },
        3: { kind: 'keyboard', usage: 0x29, modifiers: 0x03 },
      },
      provenance: 'mirror',
    });
    const maps = sim.packets.filter((p) => p[0] === winbond.KEYMAP_CMD);
    const entry = (slot: number) => {
      const p = maps[Math.floor(slot / 14)]!;
      const at = 5 + (slot % 14) * 4;
      return [...p.subarray(at, at + 4)];
    };
    expect(entry(14)).toEqual([0x07, 0x10, 0x00, 0x00]);
    expect(entry(2)).toEqual([0x13, 0xe3, 0x2b, 0x00]);
    expect(entry(3)).toEqual([0x13, 0xe0, 0xe1, 0x29]);
  });

  it('restores the key map from the driver’s default table', async () => {
    const { driver, sim } = await connect();
    await driver.restoreDefaults('keymap');
    const maps = sim.packets.filter((p) => p[0] === winbond.KEYMAP_CMD);
    expect(maps).toHaveLength(10);
    expect([...maps[0]!.subarray(13, 17)]).toEqual([0x00, 0x3a, 0x00, 0x00]); // F1
    expect((await driver.getKeymap('base')).slots).toEqual({});
    await expect(driver.restoreDefaults('lighting')).rejects.toSatisfy((e) => isOpenKeyError(e));
  });

  it('writes the sleep time as the official driver does, with its limits', async () => {
    const { driver, sim } = await connect();
    expect(driver.getSettingsSchema().sleepTime?.map((o) => o.value)).toEqual([
      300, 600, 900, 1800, 3600,
    ]);
    await driver.setSystemSettings({ sleepTime: 600 });
    const p = sim.packets.at(-1)!;
    expect([...p.subarray(0, 6)]).toEqual([0x01, 0, 0, 0, 0x01, 0x00]);
    expect([...p.subarray(13, 17)]).toEqual([0x02, 0x58, 0x02, 0x58]);
    expect(await driver.getSystemSettings()).toEqual({ sleepTime: 600 });
    expect(() => winbond.sleepPacket(0, 120)).toThrow(/300/);
    expect(() => winbond.sleepPacket(900, 600)).toThrow(/later/);
  });

  it('refuses key-map entries it cannot encode, sending nothing', async () => {
    const { driver, sim } = await connect();
    await expect(
      driver.setKeymap({
        layer: 'base',
        slots: { 45: { kind: 'keyboard', usage: 0x04, modifiers: 0x07 } },
        provenance: 'mirror',
      }),
    ).rejects.toSatisfy((e) => isOpenKeyError(e));
    await expect(
      driver.setKeymap({
        layer: 'base',
        slots: { 45: { kind: 'special', code: 0x99 } },
        provenance: 'mirror',
      }),
    ).rejects.toSatisfy((e) => isOpenKeyError(e));
    await expect(
      driver.setKeymap({ layer: 'layer2', slots: {}, provenance: 'mirror' }),
    ).rejects.toSatisfy((e) => isOpenKeyError(e));
    expect(sim.packets).toEqual([]);
  });

  it('offers only the model query as a check, and never the lighting query', async () => {
    const { driver, sim } = await connect();
    expect(isDiagnosticsDriver(driver)).toBe(true);
    if (!isDiagnosticsDriver(driver)) return;
    expect(driver.listProtocolChecks().map((c) => [c.id, c.command, c.effect])).toEqual([
      ['model-query', '15', 'read-only'],
    ]);
    await expect(driver.runProtocolCheck('lighting-query')).rejects.toThrow(
      /Unknown protocol check/,
    );
    await expect(driver.runProtocolCheck('bootloader')).rejects.toThrow(/Unknown protocol check/);
    expect(sim.packets).toEqual([]);
    sim.answersQueries = false;
    expect((await driver.runProtocolCheck('model-query')).status).toBe('no-answer');
  });

  it('marks the MK870 features its owner tested as verified, and only on the MK870', async () => {
    const { driver } = await connect();
    const caps = driver.getCapabilities();
    for (const f of ['rgb', 'perKeyRgb', 'keymap', 'macros'] as const) {
      expect(caps[f].confidence).toBe(Evidence.VERIFIED);
      expect(caps[f].source).toMatch(/owner test, OpenKey issue #13/);
      expect(writeDecision(caps[f], { simulated: false, experimentalEnabled: false })).toEqual({
        kind: 'allowed',
      });
    }
    // Not yet owner-tested: stays behind the experimental opt-in.
    for (const f of ['fnLayer', 'sleep'] as const) {
      expect(caps[f].confidence).toBe(Evidence.INFERRED);
      expect(writeDecision(caps[f], { simulated: false, experimentalEnabled: false }).kind).toBe(
        'experimental',
      );
    }
    expect(caps.rgb.read).toBe('mirror');
    const pulsar = (
      await connect(
        new WinbondSimulator({
          vendorId: 0x0416,
          productId: 0xb23c,
          productName: 'Gaming Keyboard',
        }),
      )
    ).driver.getCapabilities();
    expect(pulsar.keymap.confidence).toBe(Evidence.INFERRED);
    expect(pulsar.rgb.confidence).toBe(Evidence.OBSERVED);
  });

  it('declares the MK870 identity verified on hardware, with its evidence file', () => {
    const [v] = winbond.winbondProtocol.manifest.verifiedIdentities;
    expect(v).toMatchObject({ vendorId: 0x0416, productId: 0xc345, transport: 'usb' });
    const file = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../..', v!.evidence), 'utf8'),
    ) as {
      confidence: string;
      verified: { feature: string }[];
    };
    expect(file.confidence).toBe('VERIFIED');
    expect(file.verified.map((x) => x.feature)).toEqual(['rgb', 'perKeyRgb', 'keymap', 'macros']);
  });

  it('offers the Pulsar PCMK only the effects both sources agree on', async () => {
    const { driver } = await connect(
      new WinbondSimulator({ vendorId: 0x0416, productId: 0xb23c, productName: 'Gaming Keyboard' }),
    );
    expect((await driver.getDeviceInfo()).model).toBe('Pulsar PCMK TKL / KT108');
    expect(driver.getRgbEffects().effects.map((e) => e.id)).toEqual([0, 1, 2, 3, 6, 7, 8, 0x0a]);
    await expect(
      driver.setRgbConfig({ ...winbond.DEFAULT_CONFIG, effect: 0x0f }),
    ).rejects.toSatisfy((e) => isOpenKeyError(e));
  });

  it('shows the lighting OpenKey last wrote (the keyboard cannot report it)', async () => {
    const { driver } = await connect();
    expect(await driver.getRgbConfig()).toEqual(winbond.DEFAULT_CONFIG);
    const config = {
      effect: 0x02,
      color: { r: 10, g: 20, b: 30 },
      color2: { r: 40, g: 50, b: 60 },
      colorful: true,
      brightness: 3,
      speed: 1,
      direction: 'outwards' as const,
    };
    await driver.setRgbConfig(config);
    expect(await driver.getRgbConfig()).toEqual(config);
  });

  describe('the 45 lighting captures from an MK870 (issue #13)', () => {
    it('has one capture per effect, direction, colour, brightness and speed step', () => {
      expect(CAPTURES.reportId).toBe(1);
      expect(CAPTURES.captures).toHaveLength(45);
    });

    for (const c of CAPTURES.captures)
      it(`reproduces ${c.capture} byte for byte`, () => {
        const bytes = hexBytes(c.packet);
        expect(bytes[0]).toBe(CAPTURES.reportId);
        const p = bytes.slice(1);
        // The settings the owner made, read from the capture with OpenKey's own names.
        const config = {
          effect: p[5]!,
          brightness: p[6]!,
          speed: p[7]!,
          color: { r: p[8]!, g: p[9]!, b: p[10]! },
          color2: { r: p[11]!, g: p[12]!, b: p[13]! },
          direction: byCode(p[14]!),
          colorful: p[15] === 1,
        };
        expect([...lightingPacket(config)]).toEqual(p);
        expect(winbond.MODES.some((m) => m.id === config.effect)).toBe(true);
      });

    it('names directions and effects as the captures do', () => {
      const dir = (name: string) =>
        CAPTURES.captures.find((c) => c.capture.endsWith(`/${name}.pcapng`))!.set.direction;
      expect(dir('outwards')).toBe(winbond.DIRECTION_CODES.outwards);
      expect(dir('inwards')).toBe(winbond.DIRECTION_CODES.inwards);
      expect(dir('anticlockwise')).toBe(winbond.DIRECTION_CODES.anticlockwise);
      const code = (file: string) =>
        CAPTURES.captures.find((c) => c.capture === `Lightning Mode/${file}.pcapng`)!.set.effect;
      const named = (name: string) => winbond.MODES.find((m) => m.name.startsWith(name))!.id;
      expect(code('static')).toBe(named('Static'));
      expect(code('auto-ripple')).toBe(named('Auto ripple'));
      expect(code('fireworks')).toBe(named('Fireworks'));
      expect(code('musical-response')).toBe(named('Music response'));
      expect(code('Typing Response/up')).toBe(named('Typing response'));
    });
  });

  describe('macros (official driver, command 19)', () => {
    const copyPaste = {
      index: 0,
      events: [
        { type: 'key' as const, usage: 0xe0, down: true },
        { type: 'delay' as const, ms: 20 },
        { type: 'key' as const, usage: 0x06, down: true },
        { type: 'key' as const, usage: 0x06, down: false },
        { type: 'delay' as const, ms: 300 },
        { type: 'key' as const, usage: 0xe0, down: false },
        { type: 'mouse' as const, button: 'left' as const, down: true },
        { type: 'mouse' as const, button: 'left' as const, down: false },
      ],
    };

    it('encodes a record: header, then code, flags and the following delay per event', () => {
      const r = winbond.macroRecord(copyPaste, { mode: 'once', repeat: 1 });
      expect(r).toHaveLength(256);
      expect([...r.subarray(0, 8)]).toEqual([0, 0, 0, 24, 0, 1, 0, 0]);
      expect([...r.subarray(8, 32)]).toEqual([
        0xe0, 0x10, 0x00, 0x14, 0x06, 0x10, 0x00, 0x00, 0x06, 0x00, 0x01, 0x2c, 0xe0, 0x00, 0x00,
        0x00, 0x01, 0x11, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00,
      ]);
      expect(r.subarray(32).every((b) => b === 0)).toBe(true);
      const looped = winbond.macroRecord(copyPaste, { mode: 'repeat', repeat: 5 });
      expect([looped[1], looped[5]]).toEqual([1, 5]);
      expect(winbond.macroRecord(copyPaste, { mode: 'while-held', repeat: 9 })[1]).toBe(3);
    });

    it('splits a record into five packets of 58, 58, 58, 58 and 24 bytes', () => {
      const r = winbond.macroRecord(copyPaste, { mode: 'once', repeat: 1 });
      const ps = winbond.macroPackets(3, r);
      expect(ps.map((p) => [...p.subarray(0, 5)])).toEqual([
        [0x19, 3, 0, 0, 0x3a],
        [0x19, 3, 0, 1, 0x3a],
        [0x19, 3, 0, 2, 0x3a],
        [0x19, 3, 0, 3, 0x3a],
        [0x19, 3, 0, 4, 0x18],
      ]);
      expect([...ps[0]!.subarray(5, 63)]).toEqual([...r.subarray(0, 58)]);
      expect([...ps[4]!.subarray(5, 29)]).toEqual([...r.subarray(232, 256)]);
    });

    it('stores a macro on the keyboard when a key is bound to it, and clears unused slots', async () => {
      const { driver, sim } = await connect();
      expect(driver.getKeyActionKinds()).toContain('macro');
      expect(driver.getMacroLimits().slots).toBe(10);
      await driver.setMacros([copyPaste]);
      // F5 (slot 7) plays macro 1 three times.
      await driver.setKeymap({
        layer: 'base',
        slots: { 7: { kind: 'macro', index: 0, mode: 'repeat', repeat: 3 } },
        provenance: 'mirror',
      });
      const stored = sim.macroRecords.get(0)!;
      expect([...stored.subarray(0, 8)]).toEqual([0, 1, 0, 24, 0, 3, 0, 0]);
      expect(sim.macroRecords.get(1)!.every((b) => b === 0)).toBe(true);
      expect(sim.macroRecords.size).toBe(10);
      const maps = sim.packets.filter((p) => p[0] === winbond.KEYMAP_CMD);
      expect([...maps[0]!.subarray(5 + 7 * 4, 5 + 8 * 4)]).toEqual([0x10, 0x01, 0x00, 0x00]);
      // Macros go out before the key map, so no key points at a missing slot.
      expect(sim.packets.findIndex((p) => p[0] === 0x19)).toBeLessThan(
        sim.packets.findIndex((p) => p[0] === 0x18),
      );
      expect(await driver.getMacros()).toEqual([copyPaste]);
    });

    it('refuses macros it cannot store, before sending anything', async () => {
      const { driver, sim } = await connect();
      const long = {
        index: 1,
        events: Array.from({ length: 63 }, (_, i) => ({
          type: 'key' as const,
          usage: 0x04,
          down: i % 2 === 0,
        })),
      };
      await driver.setKeymap({
        layer: 'base',
        slots: { 7: { kind: 'macro', index: 1, mode: 'once', repeat: 1 } },
        provenance: 'mirror',
      });
      sim.packets.length = 0;
      await expect(driver.setMacros([long])).rejects.toThrow(/62/);
      await expect(
        driver.setKeymap({
          layer: 'base',
          slots: {
            7: { kind: 'macro', index: 0, mode: 'once', repeat: 1 },
            8: { kind: 'macro', index: 0, mode: 'toggle', repeat: 1 },
          },
          provenance: 'mirror',
        }),
      ).rejects.toThrow(/different play modes/);
      await expect(driver.setMacros([{ index: 12, events: [] }])).rejects.toThrow(/slots/);
      expect(sim.packets).toEqual([]);
    });

    it('stops when the keyboard does not confirm a macro packet', async () => {
      const { driver, sim } = await connect();
      sim.acksMacros = false;
      await driver
        .setKeymap({
          layer: 'base',
          slots: { 7: { kind: 'macro', index: 0, mode: 'once', repeat: 1 } },
          provenance: 'mirror',
        })
        .catch(() => undefined);
      sim.packets.length = 0;
      await expect(driver.setMacros([copyPaste])).rejects.toThrow(/did not confirm/);
      // Four attempts of the first packet, then nothing more.
      expect(sim.packets.map((p) => p[0])).toEqual([0x19, 0x19, 0x19, 0x19]);
    });
  });

  it('records the driver model code from the model query, and nothing that is not on its list', async () => {
    const { driver, sim } = await connect();
    if (!isDiagnosticsDriver(driver)) throw new Error('no checks');
    const r = await driver.runProtocolCheck('model-query');
    expect([...sim.packets.at(-1)!.subarray(0, 2)]).toEqual([0x15, 0x00]);
    expect(r).toMatchObject({ status: 'answered', facts: { driverModel: 'K223RGB' } });
    expect(r.detail).toMatch(/K223RGB/);
    sim.modelCode = 'SN20260123456';
    const other = await driver.runProtocolCheck('model-query');
    expect(other.facts).toBeUndefined();
    expect(JSON.stringify(other)).not.toContain('SN2026');
    expect(winbond.DRIVER_MODEL_CODES.size).toBeGreaterThan(150);
  });

  describe('Fn layers and onboard profiles', () => {
    it('writes the FN1 layer from the official default table, keeping the Fn key', async () => {
      const { driver, sim } = await connect();
      expect(driver.getLayerIds()).toEqual(['base', 'fn']);
      const fn = driver.getCapabilities().fnLayer;
      expect([fn.write, fn.blockedReason]).toEqual([true, undefined]);
      expect(fn.note).toMatch(/Fn\+Tab/);
      expect(fn.note).toMatch(/Fn\+Esc/);
      await driver.setKeymap({
        layer: 'fn',
        slots: {
          2: { kind: 'special', code: 0x10, label: 'Volume up' },
          45: { kind: 'keyboard', usage: 0x2b, modifiers: 0x08 },
        },
        provenance: 'mirror',
      });
      const maps = sim.packets.filter((p) => p[0] === winbond.KEYMAP_CMD);
      expect(maps).toHaveLength(10);
      expect(maps.every((p) => p[1] === 1)).toBe(true);
      const entry = (slot: number) => {
        const p = maps[Math.floor(slot / 14)]!;
        const at = 5 + (slot % 14) * 4;
        return [...p.subarray(at, at + 4)];
      };
      expect(entry(0)).toEqual([0x00, 0x29, 0x00, 0x00]); // Esc, default
      expect(entry(2)).toEqual([0x07, 0x10, 0x00, 0x00]); // F1 → volume up
      expect(entry(45)).toEqual([0x13, 0xe3, 0x2b, 0x00]); // Q → Win+Tab
      expect(entry(winbond.FN_SLOT)).toEqual([0x01, 0x00, 0x00, 0x00]); // Fn stays Fn
      expect((await driver.getKeymap('fn')).slots[2]).toMatchObject({ kind: 'special' });
      // The base layer is untouched.
      expect((await driver.getKeymap('base')).slots).toEqual({});
    });

    it('restores the FN1 layer to the default table', async () => {
      const { driver, sim } = await connect();
      await driver.restoreDefaults('fnLayer');
      const maps = sim.packets.filter((p) => p[0] === winbond.KEYMAP_CMD);
      expect(maps).toHaveLength(10);
      expect(maps.every((p) => p[1] === 1)).toBe(true);
      expect([...maps[0]!.subarray(13, 17)]).toEqual([0x00, 0x3a, 0x00, 0x00]); // F1
    });

    it('stores macros used on FN1, and needs one play mode per macro across layers', async () => {
      const { driver, sim } = await connect();
      await driver.setMacros([
        {
          index: 2,
          events: [
            { type: 'key', usage: 0x04, down: true },
            { type: 'key', usage: 0x04, down: false },
          ],
        },
      ]);
      await driver.setKeymap({
        layer: 'fn',
        slots: { 7: { kind: 'macro', index: 2, mode: 'repeat', repeat: 4 } },
        provenance: 'mirror',
      });
      expect([...sim.macroRecords.get(2)!.subarray(0, 8)]).toEqual([0, 1, 0, 8, 0, 4, 0, 0]);
      await expect(
        driver.setKeymap({
          layer: 'base',
          slots: { 8: { kind: 'macro', index: 2, mode: 'once', repeat: 1 } },
          provenance: 'mirror',
        }),
      ).rejects.toThrow(/different play modes/);
    });

    it('keeps a third layer blocked without its confirmed factory table', async () => {
      const { driver, sim } = await connect();
      await expect(
        driver.setKeymap({ layer: 'layer2', slots: {}, provenance: 'mirror' }),
      ).rejects.toSatisfy(
        (e) => isOpenKeyError(e) && e.code === 'SAFETY_BLOCKED' && /third/.test(e.message),
      );
      expect(sim.packets).toEqual([]);
      // The model is known only after the user runs the model check.
      expect((await driver.getDeviceInfo()).fields).toEqual([]);
      if (isDiagnosticsDriver(driver)) await driver.runProtocolCheck('model-query');
      expect((await driver.getDeviceInfo()).fields).toContainEqual(
        expect.objectContaining({ key: 'driverModel', value: 'K223RGB' }),
      );
    });

    it('shows no driver model when the keyboard reports none', async () => {
      const sim = new WinbondSimulator();
      sim.modelCode = 'NOT_A_MODEL';
      const { driver } = await connect(sim);
      if (isDiagnosticsDriver(driver)) await driver.runProtocolCheck('model-query');
      expect((await driver.getDeviceInfo()).fields).toEqual([]);
    });

    it('writes layer 1 with the factory table for every key the user leaves alone', async () => {
      const factory = Array.from(
        { length: 132 },
        (_, i) => [0x07, i % 2 ? 0x10 : 0x11, 0x00, 0x00] as [number, number, number, number],
      );
      winbond.FN_FACTORY_TABLES.set('K223RGB', { fn1: factory });
      try {
        const { driver, sim } = await connect();
        if (isDiagnosticsDriver(driver)) await driver.runProtocolCheck('model-query');
        sim.packets.length = 0;
        const fn = driver.getCapabilities().fnLayer;
        expect([fn.write, fn.blockedReason]).toEqual([true, undefined]);
        await driver.setKeymap({
          layer: 'fn',
          slots: { 2: { kind: 'keyboard', usage: 0x04, modifiers: 0 } },
          provenance: 'mirror',
        });
        const maps = sim.packets.filter((p) => p[0] === winbond.KEYMAP_CMD);
        expect(maps).toHaveLength(10);
        expect(maps.every((p) => p[1] === 1)).toBe(true);
        expect([...maps[0]!.subarray(5, 9)]).toEqual(factory[0]);
        expect([...maps[0]!.subarray(13, 17)]).toEqual([0x00, 0x04, 0x00, 0x00]);
        expect([...maps[9]!.subarray(5 + 4 * 4, 5 + 5 * 4)]).toEqual(factory[130]);
        expect((await driver.getKeymap('fn')).slots[2]).toEqual({
          kind: 'keyboard',
          usage: 0x04,
          modifiers: 0,
        });
      } finally {
        winbond.FN_FACTORY_TABLES.delete('K223RGB');
      }
    });

    it('explains the two onboard layouts and how to switch them', async () => {
      const { driver } = await connect();
      const p = driver.getCapabilities().profiles;
      expect(p.write).toBe(false);
      expect(p.blockedReason).toMatch(/default layer and FN1/);
      expect(p.blockedReason).toMatch(/Fn\+Tab/);
      const gate = writeDecision(p, { experimentalEnabled: true, simulated: false });
      expect(gate).toEqual({ kind: 'blocked', reason: p.blockedReason });
    });
  });
});

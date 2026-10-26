import { describe, expect, it } from 'vitest';
import {
  Evidence,
  FeatureStatus,
  MemoryStateStore,
  PacketLog,
  guardWrites,
  isOpenKeyError,
  toHex,
  writeDecision,
} from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import { byTech, createDefaultRegistry, openDriver } from '@openkey/protocols';
import { noSleep } from '../helpers.js';

const { ByTechSimulator, F75_PAGE, R75_IDENTITY } = byTech;
const R75 = { vendorId: 0x258a, productId: 0x015e, productName: 'Gaming Keyboard' };
const fast = { cmdDelayMs: 0, sleep: noSleep };

async function connect(
  sim: InstanceType<typeof ByTechSimulator>,
  consent: string[] = ['by-tech'],
  store = new MemoryStateStore(),
) {
  const registry = createDefaultRegistry();
  const group = sim.device.group();
  const detection = await registry.detect(group, { level: 'handshake', consent });
  const kb = await openDriver(group, detection, { registry, log: new PacketLog(), store, ...fast });
  return { ...kb, driver: kb.driver as InstanceType<typeof byTech.ByTechDriver>, store };
}

describe('BY Tech OEM protocol: frames', () => {
  it('builds the identity request exactly as the vendor driver does (06 82 01 00 01 00 06 00 …)', () => {
    const f = byTech.frame(0x82, 0x01, 1, 0, undefined, 6);
    expect(f.length).toBe(519);
    expect(toHex(f.subarray(0, 7))).toBe('82 01 00 01 00 06 00');
    expect(f.subarray(7).every((b) => b === 0)).toBe(true);
  });

  it('splits writes into 512-byte packages numbered from 0', () => {
    const frames = byTech.writeFrames(0x04, 0, new Uint8Array(600));
    expect(frames.map((f) => [f[3], f[4], f[5]! | (f[6]! << 8)])).toEqual([
      [2, 0, 512],
      [2, 1, 88],
    ]);
  });

  it('rejects a reply that does not echo the command', () => {
    const r = new Uint8Array(519);
    r[0] = 0x84;
    expect(() => byTech.replyData(r, 0x82, 6)).toThrow(/expected 0x82/);
  });
});

describe('BY Tech OEM protocol: detection', () => {
  it('identifies an AULA F75 on 258A:010C after consent', async () => {
    const sim = new ByTechSimulator();
    const before = await createDefaultRegistry().detect(sim.device.group(), { level: 'handshake' });
    expect(before.candidates.find((c) => c.protocol.id === 'by-tech')!.consent).toMatchObject({
      required: true,
    });
    expect(sim.device.traffic).toEqual([]);
    const r = await createDefaultRegistry().detect(sim.device.group(), {
      level: 'handshake',
      consent: ['by-tech'],
    });
    expect(r.selected).toMatchObject({ protocolId: 'by-tech', identification: 'identified' });
    expect(r.candidates.find((c) => c.protocol.id === 'by-tech')!.probe!.facts.model).toBe(
      'AULA F75',
    );
  });

  it('asks before the identity read on the RK R75 and sends nothing until allowed', async () => {
    const sim = new ByTechSimulator({ identity: R75, modelCode: R75_IDENTITY });
    const r = await createDefaultRegistry().detect(sim.device.group(), { level: 'handshake' });
    const cand = r.candidates.find((c) => c.protocol.id === 'by-tech')!;
    expect(cand.consent).toMatchObject({ required: true, granted: false });
    expect(r.selected?.identification ?? 'descriptor').toBe('descriptor');
    expect(sim.device.traffic).toEqual([]);
    const ok = await createDefaultRegistry().detect(sim.device.group(), {
      level: 'handshake',
      consent: ['by-tech'],
    });
    expect(ok.selected?.protocolId).toBe('by-tech');
    expect(ok.candidates.find((c) => c.protocol.id === 'by-tech')!.probe!.facts.model).toBe(
      'RK R75 RGB (wired)',
    );
    // Only the declared read: one SET (82 01) and one GET.
    expect(sim.device.traffic.map((t) => `${t.op}:${t.data[0]?.toString(16) ?? ''}`)).toEqual([
      'feature-set:82',
      'feature-get:82',
    ]);
  });

  it('offers the BY Tech adapter for the descriptor in the owner’s R75 support bundle', async () => {
    // openkey-diagnostics-258A-015E.json (2026-10-11): one interface, five collections.
    const col = (usagePage: number, usage: number, kind?: 'in' | 'feature', id = 0, size = 0) => ({
      usagePage,
      usage,
      inputReports: kind === 'in' ? [{ reportId: id, size }] : [],
      outputReports: [],
      featureReports: kind === 'feature' ? [{ reportId: id, size }] : [],
    });
    const dev = new MockHidDevice(R75, [
      {
        info: {
          collections: [
            col(0x0c, 0x01, 'in', 2, 2),
            col(0xff00, 0x01, 'in', 3, 3),
            col(0xff00, 0x01, 'feature', 5, 5),
            col(0xff00, 0x01, 'feature', 6, 519),
            col(0x01, 0x02),
          ],
        },
        behavior: {},
      },
    ]);
    const report = await createDefaultRegistry().detect(dev.group(), { level: 'handshake' });
    const c = report.candidates.find((x) => x.protocol.id === 'by-tech');
    expect(c?.match.applicable).toBe(true);
    expect(c?.consent).toMatchObject({ required: true, granted: false });
    expect(report.catalog?.model).toMatch(/R75/);
    expect(dev.traffic).toEqual([]);
  });

  it('never selects the family from descriptors alone', async () => {
    const sim = new ByTechSimulator({ identity: R75, modelCode: R75_IDENTITY });
    const r = await createDefaultRegistry().detect(sim.device.group(), { level: 'descriptor' });
    expect(r.candidates.find((c) => c.protocol.id === 'by-tech')!.probe?.identified).toBeFalsy();
  });
});

describe('BY Tech OEM protocol: AULA lighting', () => {
  it('decodes the settings page of an F75', async () => {
    const { driver } = await connect(new ByTechSimulator());
    expect(driver.displayName).toBe('AULA F75');
    expect(await driver.getRgbConfig()).toMatchObject({
      effect: 1,
      brightness: 9,
      speed: 4,
      colorful: false,
      color: { r: 255, g: 0, b: 0 },
    });
    expect(driver.getRgbEffects().effects.find((e) => e.id === 21)?.name).toBe('Off');
    expect((await driver.getSystemSettings()).sleepTime).toBe(10);
  });

  it('patches only the changed bytes and reads them back', async () => {
    const sim = new ByTechSimulator();
    const { driver } = await connect(sim);
    const cfg = await driver.getRgbConfig();
    await driver.setRgbConfig({ ...cfg, effect: 2, brightness: 5, speed: 2, colorful: true });
    expect(sim.writes).toHaveLength(1);
    expect(byTech.diffPages(F75_PAGE, sim.page).map((d) => d.offset)).toEqual([0x0a, 0x3c, 0x3d]);
    expect(sim.page[0x3c]).toBe(5);
    expect(sim.page[0x3d]).toBe(0x27);
    expect(await driver.getRgbConfig()).toMatchObject({
      effect: 2,
      brightness: 5,
      speed: 2,
      colorful: true,
    });
  });

  it('does not write when nothing changed, and never without the 5A A5 marker', async () => {
    const sim = new ByTechSimulator();
    const { driver } = await connect(sim);
    await driver.setRgbConfig(await driver.getRgbConfig());
    expect(sim.writes).toHaveLength(0);
    const config = await driver.getRgbConfig();
    sim.page[127] = 0; // the keyboard's end marker is gone: the page must not be written back
    await expect(driver.setRgbConfig({ ...config, brightness: 2 })).rejects.toThrow(/5A A5/);
    expect(sim.writes).toHaveLength(0);
  });

  it('reports a read-back mismatch when the keyboard does not keep the page', async () => {
    const sim = new ByTechSimulator();
    const { driver } = await connect(sim);
    const original = sim.page.slice();
    // Firmware that acknowledges but discards writes.
    const orig = sim.writes.push.bind(sim.writes);
    sim.writes.push = (...p: Uint8Array[]) => {
      queueMicrotask(() => (sim.page = original.slice()));
      return orig(...p);
    };
    await expect(
      driver.setRgbConfig({ ...(await driver.getRgbConfig()), brightness: 3 }),
    ).rejects.toSatisfy((e) => isOpenKeyError(e) && e.code === 'READBACK_MISMATCH');
  });

  it('keeps lighting writes behind the experimental opt-in (third-party evidence only)', async () => {
    const { driver } = await connect(new ByTechSimulator());
    const caps = driver.getCapabilities();
    expect(caps.rgb.confidence).toBe(Evidence.INFERRED);
    expect(writeDecision(caps.rgb, { simulated: false, experimentalEnabled: false }).kind).toBe(
      'experimental',
    );
    const guarded = guardWrites(driver, () => ({ simulated: false, experimentalEnabled: false }));
    await expect(guarded.setRgbConfig(await driver.getRgbConfig())).rejects.toSatisfy(
      (e) => isOpenKeyError(e) && e.code === 'SAFETY_BLOCKED',
    );
    for (const f of ['keymap', 'perKeyRgb', 'macros'] as const)
      expect(caps[f].status).toBe(FeatureStatus.NOT_YET_REVERSE_ENGINEERED);
  });
});

/** A BY Tech board whose model code is in no table: its page layout is unknown. */
const UNKNOWN_CODE = Uint8Array.of(0x07, 0, 0, 0, 0, 0x99);

describe('BY Tech OEM protocol: RK R75 and learning the layout', () => {
  it('keeps an unknown model read-only until the layout is confirmed', async () => {
    const sim = new ByTechSimulator({ identity: R75, modelCode: UNKNOWN_CODE });
    const { driver } = await connect(sim, ['by-tech']);
    expect(driver.model).toBeNull();
    expect(driver.getCapabilities().rgb.status).toBe(FeatureStatus.NOT_YET_REVERSE_ENGINEERED);
    await expect(driver.getRgbConfig()).rejects.toThrow(/not confirmed/);
    expect(sim.writes).toHaveLength(0);
  });

  it('learns the layout from the keyboard’s own shortcuts, writing nothing', async () => {
    const sim = new ByTechSimulator({ identity: R75, modelCode: UNKNOWN_CODE });
    const { driver, store } = await connect(sim, ['by-tech']);
    const p0 = await driver.readSettingsPage();
    sim.pressNextEffect();
    const p1 = await driver.readSettingsPage();
    sim.pressBrightnessUp();
    const p2 = await driver.readSettingsPage();
    const a = byTech.singleChange(p0, p1);
    const b = byTech.singleChange(p1, p2);
    const result = byTech.inferLayout(a, b, p2[a.ok ? a.offset : 0]!);
    expect(result).toEqual({ ok: true, layout: { effect: 0x0a, sleep: null, effectTable: 0x3a } });
    expect(sim.writes).toHaveLength(0);
    await driver.learnLayout((result as { layout: byTech.PageLayout }).layout);
    expect(driver.getCapabilities().rgb.confidence).toBe(Evidence.OBSERVED);
    // Remembered for the next connection.
    const again = await connect(sim, ['by-tech'], store);
    expect(again.driver.layoutLearned).toBe(true);
    expect((await again.driver.getRgbConfig()).effect).toBe(2);
  });

  it('shows the R75’s own keyboard and the controls its configuration gives each effect', async () => {
    const sim = new ByTechSimulator({ identity: R75, modelCode: R75_IDENTITY });
    const { driver } = await connect(sim, ['by-tech']);
    const layout = driver.getLayout();
    expect(layout.id).toBe('rk-r75');
    expect(layout.keys).toHaveLength(80);
    expect(layout.extras?.map((e) => e.kind)).toEqual(['knob']);
    // KB.ini matrix indices: Esc 0, Fn 65, Right 95; the R75 has no End key.
    const byLabel = (l: string) => layout.keys.filter((k) => k.label === l).map((k) => k.slot);
    expect(byLabel('Esc')).toEqual([0]);
    expect(byLabel('Fn')).toEqual([65]);
    expect(byLabel('→')).toEqual([95]);
    expect(byLabel('End')).toEqual([]);
    const effects = driver.getRgbEffects().effects;
    // LedOpt1–17, 19 and 20 (18 is absent).
    expect(effects.map((e) => e.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20,
    ]);
    expect(effects[0]!.controls).toMatchObject({ speed: false, brightness: true, color: true });
    expect(effects[2]!.controls).toMatchObject({ speed: true, color: false, colorful: false });
    expect(effects.find((e) => e.id === 10)?.name).toBe('Retro snake (default)');
    expect(effects[0]!.name).toBe('Fixed on');
    expect(driver.getRgbEffects().customEffect).toBe(18);
    expect(effects.at(-1)!.controls).toMatchObject({ brightness: false, speed: false });
    expect(driver.getSettingsSchema()).toEqual({});
    expect(sim.writes).toHaveLength(0);
  });

  it('refuses ambiguous observations', () => {
    const a = F75_PAGE.slice();
    const b = F75_PAGE.slice();
    expect(byTech.singleChange(a, b)).toMatchObject({ ok: false, reason: 'nothing-changed' });
    b[1] = 9;
    b[2] = 9;
    expect(byTech.singleChange(a, b)).toMatchObject({ ok: false, reason: 'too-many-changes' });
  });
});

describe('BY Tech OEM protocol: R75 key map and per-key colours (RK web driver)', () => {
  const r75 = () => new ByTechSimulator({ identity: R75, modelCode: R75_IDENTITY });
  const word = (m: Uint8Array, i: number) => new DataView(m.buffer, m.byteOffset).getUint32(i * 4);

  it('reads and writes lighting with the documented page layout, no teaching needed', async () => {
    const sim = r75();
    const { driver } = await connect(sim);
    expect(driver.displayName).toBe('RK R75 RGB (wired)');
    const caps = driver.getCapabilities();
    expect(caps.rgb).toMatchObject({ read: 'device', write: true, confidence: Evidence.INFERRED });
    expect(caps.rgb.source).toMatch(/RK’s own web driver/);
    await driver.setRgbConfig({
      effect: 11,
      brightness: 3,
      speed: 2,
      color: { r: 0, g: 0, b: 255 },
      colorful: false,
      direction: 'right',
    });
    expect(sim.page[0x0a]).toBe(11);
    expect([sim.page[0x38 + 22], sim.page[0x38 + 23]]).toEqual([3, 0x22]);
  });

  it('reads a layer, changes a key, writes the whole layer and reads it back', async () => {
    const sim = r75();
    const base = new Uint8Array(504);
    const v = new DataView(base.buffer);
    v.setUint32(0, 0x29); // Esc
    v.setUint32(3 * 4, 0x39); // Caps
    v.setUint32(4 * 4, 0x20000); // Left Shift
    v.setUint32(65 * 4, 0x0d000000); // Fn
    sim.matrices.set(0, base);
    const { driver } = await connect(sim);
    const caps = driver.getCapabilities();
    expect([caps.keymap.write, caps.fnLayer.write, caps.keymap.read]).toEqual([
      true,
      true,
      'device',
    ]);
    expect(driver.getLayerIds()).toEqual(['base', 'fn', 'layer2']);
    const km = await driver.getKeymap('base');
    expect(km.provenance).toBe('device');
    expect(km.slots[0]).toEqual({ kind: 'keyboard', usage: 0x29, modifiers: 0 });
    expect(km.slots[4]).toEqual({ kind: 'keyboard', usage: 0xe1, modifiers: 0 });
    expect(km.slots[65]).toEqual({ kind: 'special', code: 0x0d000000, label: 'Fn' });
    await driver.setKeymap({
      layer: 'base',
      slots: {
        3: { kind: 'keyboard', usage: 0x06, modifiers: 0x01 },
        0: { kind: 'consumer', usage: 0xe9 },
        1: { kind: 'mouse', action: 'back' },
      },
      provenance: 'device',
    });
    const w = sim.matrixWrites.at(-1)!;
    expect(w.parameter).toBe(0);
    expect(word(w.data, 3)).toBe(0x00010006);
    expect(word(w.data, 0)).toBe(0x020000e9);
    expect(word(w.data, 1)).toBe(0x01040100);
    expect(word(w.data, 65)).toBe(0x0d000000);
    // FN2 layer: parameter 2.
    await driver.setKeymap({
      layer: 'layer2',
      slots: { 9: { kind: 'keyboard', usage: 0x04, modifiers: 0 } },
      provenance: 'device',
    });
    expect(sim.matrixWrites.at(-1)!.parameter).toBe(2);
    // "Default" on the base layer is the key's factory usage from RK's key table.
    await driver.setKeymap({
      layer: 'base',
      slots: { 3: { kind: 'default' } },
      provenance: 'device',
    });
    expect(word(sim.matrixWrites.at(-1)!.data, 3)).toBe(0x39);
  });

  it('never changes Fn, refuses unknown FN-layer defaults, and catches a keyboard that ignored a write', async () => {
    const sim = r75();
    const base = new Uint8Array(504);
    new DataView(base.buffer).setUint32(65 * 4, 0x0d000000);
    sim.matrices.set(0, base);
    const { driver } = await connect(sim);
    await expect(
      driver.setKeymap({
        layer: 'base',
        slots: { 65: { kind: 'keyboard', usage: 0x04, modifiers: 0 } },
        provenance: 'device',
      }),
    ).rejects.toThrow(/Fn keys are not changed/);
    await expect(
      driver.setKeymap({ layer: 'fn', slots: { 5: { kind: 'default' } }, provenance: 'device' }),
    ).rejects.toThrow(/factory function of this key on this FN layer/);
    expect(sim.matrixWrites).toEqual([]);
    sim.keepsWrites = false;
    await expect(
      driver.setKeymap({
        layer: 'base',
        slots: { 0: { kind: 'keyboard', usage: 0x05, modifiers: 0 } },
        provenance: 'device',
      }),
    ).rejects.toSatisfy((e) => isOpenKeyError(e) && e.code === 'READBACK_MISMATCH');
  });

  it('runs reads one after another, so two editors loading together each get their own answer', async () => {
    const sim = r75();
    const { driver } = await connect(sim);
    const [rgb, colors, keys] = await Promise.all([
      driver.getRgbConfig(),
      driver.getPerKeyRgb(),
      driver.getKeymap('base'),
    ]);
    expect(rgb.effect).toBe(1);
    expect(Object.keys(colors).length).toBeGreaterThan(70);
    expect(keys.provenance).toBe('device');
  });

  it('writes per-key colours as three planes, reads them back, then selects the Custom effect', async () => {
    const sim = r75();
    const { driver } = await connect(sim);
    expect(driver.getCapabilities().perKeyRgb).toMatchObject({ read: 'device', write: true });
    await driver.setPerKeyRgb({ 0: { r: 255, g: 1, b: 2 }, 95: { r: 3, g: 4, b: 255 } });
    const c = sim.colorWrites.at(-1)!;
    expect([c[0], c[126], c[252]]).toEqual([255, 1, 2]);
    expect([c[95], c[95 + 126], c[95 + 252]]).toEqual([3, 4, 255]);
    expect(sim.page[0x0a]).toBe(18);
    const back = await driver.getPerKeyRgb();
    expect(back[95]).toEqual({ r: 3, g: 4, b: 255 });
  });
});

describe('BY Tech OEM protocol: RK screen boards', () => {
  const M87 = { vendorId: 0x258a, productId: 0x01a2, productName: 'SINO WEALTH Gaming Keyboard' };
  const M87_CODE = Uint8Array.of(0x06, 0, 0, 0, 0, 0x23);

  it('identifies the RK M87 by its model code on its own USB ID and sets the screen clock', async () => {
    const sim = new ByTechSimulator({ identity: M87, modelCode: M87_CODE, reportId: 9 });
    const { driver } = await connect(sim);
    expect(driver.displayName).toBe('RK M87 (screen)');
    // RK web driver's M87 effect list, with off (0); no key map (its matrix positions are not known).
    const effects = driver.getRgbEffects();
    expect(effects.effects.map((e) => e.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 0,
    ]);
    expect(effects.offEffect).toBe(0);
    // Key maps from RK's web driver: its factory tables number the M87's keys by the matrix.
    expect(driver.getCapabilities().keymap.write).toBe(true);
    const layout = driver.getLayout();
    expect(layout.keys.find((k) => k.label === 'Esc')).toMatchObject({ slot: 0, light: 0 });
    expect(layout.keys.find((k) => k.id === 'F1')).toMatchObject({ slot: 6 });
    expect(layout.keys.find((k) => k.id === 'Fn')!.slot).toBe(-1);
    expect(layout.keys.filter((k) => k.id.startsWith('m')).map((k) => k.label)).toEqual(
      expect.arrayContaining(['Stop', 'Prev', 'Play', 'Next']),
    );
    expect(driver.getCapabilities().tftClock).toMatchObject({ write: true, read: 'none' });
    await driver.syncClock(new Date(2026, 2, 10, 14, 30, 45));
    // Volume/CPU/memory unknown in a browser, then 2026-03-10 14:30:45, Tuesday.
    expect([...sim.screenParams[0]!]).toEqual([0, 0, 0, 0xea, 0x07, 3, 10, 14, 30, 45, 2, 0, 0, 0]);
    expect(sim.writes).toEqual([]);
  });

  it('does not trust an RK model code on another USB ID', async () => {
    // 258A:0163 is the RK M75 in RK's web driver: known by its USB ID, never as an M87.
    const sim = new ByTechSimulator({
      identity: { ...M87, productId: 0x0163 },
      modelCode: M87_CODE,
      reportId: 9,
    });
    const { driver } = await connect(sim);
    expect(driver.model?.model).toBe('M75');
    await expect(driver.syncClock()).rejects.toThrow(/no screen clock/);
    const other = new ByTechSimulator({
      identity: { ...M87, productId: 0x0999 },
      modelCode: M87_CODE,
      reportId: 9,
    });
    expect((await connect(other)).driver.model).toBeNull();
  });

  it('knows every RK board of RK’s web driver by its USB ID, with factory tables for every layer', async () => {
    const sim = new ByTechSimulator({
      identity: { vendorId: 0x258a, productId: 0x020c, productName: 'RK Keyboard' },
      modelCode: Uint8Array.of(0x0a, 0, 0, 0, 0, 0),
    });
    const fn1 = new Uint8Array(504);
    sim.matrices.set(1, fn1);
    const { driver } = await connect(sim);
    expect(driver.displayName).toBe('RK R98PRO');
    expect(driver.getLayerIds()).toEqual(['base', 'fn', 'layer2']);
    expect(driver.getCapabilities().perKeyRgb.write).toBe(true);
    expect(driver.getRgbEffects().brightness.max).toBe(19);
    // "Default" on FN1 writes the factory function RK's web driver lists for that position.
    const board = (await byTech.rkWebBoard(0x020c))!;
    const slot = board.tables[1]!.findIndex((c, i) => c !== 0 && c !== board.tables[0]![i]);
    await driver.setKeymap({
      layer: 'fn',
      slots: { [slot]: { kind: 'default' } },
      provenance: 'device',
    });
    const w = sim.matrixWrites.at(-1)!;
    expect(w.parameter).toBe(1);
    expect(new DataView(w.data.buffer).getUint32(slot * 4)).toBe(board.tables[1]![slot]);
  });
});

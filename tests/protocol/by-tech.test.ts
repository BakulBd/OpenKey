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

describe('BY Tech OEM protocol: RK R75 and learning the layout', () => {
  it('is read-only until the layout is confirmed', async () => {
    const sim = new ByTechSimulator({ identity: R75, modelCode: R75_IDENTITY });
    const { driver } = await connect(sim, ['by-tech']);
    expect(driver.displayName).toBe('RK R75 RGB (wired)');
    expect(driver.getCapabilities().rgb.status).toBe(FeatureStatus.NOT_YET_REVERSE_ENGINEERED);
    await expect(driver.getRgbConfig()).rejects.toThrow(/not confirmed/);
    expect(sim.writes).toHaveLength(0);
  });

  it('learns the layout from the keyboard’s own shortcuts, writing nothing', async () => {
    const sim = new ByTechSimulator({ identity: R75, modelCode: R75_IDENTITY });
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

  it('refuses ambiguous observations', () => {
    const a = F75_PAGE.slice();
    const b = F75_PAGE.slice();
    expect(byTech.singleChange(a, b)).toMatchObject({ ok: false, reason: 'nothing-changed' });
    b[1] = 9;
    b[2] = 9;
    expect(byTech.singleChange(a, b)).toMatchObject({ ok: false, reason: 'too-many-changes' });
  });
});

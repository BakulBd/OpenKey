import { describe, expect, it } from 'vitest';
import {
  Evidence,
  MemoryStateStore,
  collectBackup,
  isOpenKeyError,
  planRestore,
  applyBackup,
} from '@openkey/core';
import { connectKeyboard, createDefaultRegistry, sonixFeature } from '@openkey/protocols';
import { pattern, prepareFrame } from '@openkey/tft';
import { noSleep } from '../helpers.js';

async function setup(
  identity?: ConstructorParameters<typeof sonixFeature.SonixFeatureSimulator>[0],
  consent?: string[],
) {
  const sim = new sonixFeature.SonixFeatureSimulator(identity);
  const store = new MemoryStateStore();
  const kb = await connectKeyboard(sim.device.group(), {
    registry: createDefaultRegistry(),
    level: 'handshake',
    ...(consent ? { consent } : {}),
    store,
    cmdDelayMs: 0,
    sleep: noSleep,
  });
  return { sim, store, ...kb };
}

const featureSets = (sim: InstanceType<typeof sonixFeature.SonixFeatureSimulator>) =>
  sim.device.traffic
    .filter((t) => t.op === 'feature-set')
    .map((t) => Array.from(t.data.subarray(0, 2)));

describe('sonix-feature driver against the firmware simulator', () => {
  it('detects the protocol with a VERIFIED handshake', async () => {
    const { detection } = await setup();
    expect(detection.selected).toMatchObject({
      protocolId: 'sonix-feature',
      confidence: Evidence.VERIFIED,
    });
    const probe = detection.candidates.find((c) => c.protocol.id === 'sonix-feature')!.probe!;
    expect(probe.steps.map((s) => s.status)).toEqual(['pass', 'pass']);
  });

  it('reports MAX PLUS device info and capabilities', async () => {
    const { driver } = await setup();
    const info = await driver.getDeviceInfo();
    expect(info.model).toBe('AJAZZ AK820 MAX / MAX PLUS');
    expect(info.firmware.version).toBe('1.07');
    const caps = driver.getCapabilities();
    expect(caps.keymap).toMatchObject({ read: 'mirror', write: true });
    expect(caps.perKeyRgb.read).toBe('device');
    expect(caps.encoder.write).toBe(false);
    expect((await driver.getTftInfo()).maxFrames).toBe(255);
  });

  it('writes a keymap with the official START/0x11/table/SAVE/FINISH sequence', async () => {
    const { driver, sim } = await setup();
    sim.device.traffic.length = 0;
    await driver.setKeymap({
      layer: 'base',
      provenance: 'mirror',
      slots: { 55: { kind: 'keyboard', usage: 0x29, modifiers: 0 } },
    });
    const sets = featureSets(sim);
    expect(sets[0]).toEqual([4, 0x18]);
    expect(sets[1]).toEqual([4, 0x11]);
    expect(sets.length).toBe(2 + 9 + 2);
    expect(sets.at(-2)).toEqual([4, 0x02]);
    expect(sets.at(-1)).toEqual([4, 0xf0]);
    expect(Array.from(sim.state.keymapBase!.subarray(55 * 4, 55 * 4 + 4))).toEqual([2, 0, 0x29, 0]);
    const mirror = await driver.getKeymap('base');
    expect(mirror.provenance).toBe('mirror');
    expect(mirror.slots[55]).toEqual({ kind: 'keyboard', usage: 0x29, modifiers: 0 });
  });

  it('writes the Fn layer with command 0x27', async () => {
    const { driver, sim } = await setup();
    await driver.setFnLayer({
      layer: 'fn',
      provenance: 'mirror',
      slots: { 2: { kind: 'consumer', usage: 0xe9 } },
    });
    expect(Array.from(sim.state.keymapFn!.subarray(8, 12))).toEqual([3, 0xe9, 0, 0]);
  });

  it('writes lighting and reads per-key colours back from the device', async () => {
    const { driver, sim } = await setup();
    await driver.setRgbConfig({
      effect: 1,
      color: { r: 0, g: 0, b: 255 },
      colorful: false,
      brightness: 4,
      speed: 2,
      direction: 'up',
    });
    expect(Array.from(sim.state.lighting!.subarray(0, 12))).toEqual([
      1, 0, 0, 255, 0, 0, 0, 0, 0, 4, 2, 2,
    ]);
    await driver.setPerKeyRgb({ 1: { r: 10, g: 20, b: 30 } });
    const colors = await driver.getPerKeyRgb();
    expect(colors[1]).toEqual({ r: 10, g: 20, b: 30 });
    expect((await driver.getRgbConfig()).effect).toBe(0x80);
  });

  it('uploads a TFT image over the data pipe', async () => {
    const { driver, sim } = await setup();
    const progress: string[] = [];
    await driver.uploadTftImage(
      prepareFrame(pattern('blue', 128, 128), await driver.getTftInfo()),
      (p) => progress.push(p.phase),
    );
    expect(sim.state.tft).toMatchObject({ slot: 1, chunks: 9 });
    expect(Array.from(sim.state.tft!.data.subarray(256, 258))).toEqual([0x1f, 0x00]);
    expect(progress.at(-1)).toBe('done');
    expect((await driver.getTftStatus()).lastUpload?.frames).toBe(1);
  });

  it('writes macros, settings and the clock', async () => {
    const { driver, sim } = await setup();
    await driver.setMacros([
      {
        index: 0,
        events: [
          { type: 'key', usage: 4, down: true },
          { type: 'key', usage: 4, down: false },
        ],
      },
    ]);
    expect(sim.state.macros).not.toBeNull();
    expect(sonixFeature.decodeMacroStorage(sim.state.macros!)[0]!.events).toHaveLength(4);
    await driver.setSystemSettings({ sleepTime: 3, disableWinKey: true });
    expect(sim.state.settings![6]).toBe(3);
    expect(sim.state.settings![4]).toBe(1);
    await driver.syncClock(new Date(2026, 9, 7, 12, 0, 0));
    expect(sim.state.time![2]).toBe(0x5a);
    expect(sim.state.unknownCommands).toEqual([]);
  });

  it('backs up mirrors and restores them', async () => {
    const { driver, sim } = await setup();
    await driver.setKeymap({
      layer: 'base',
      provenance: 'mirror',
      slots: { 55: { kind: 'disabled' } },
    });
    const backup = await collectBackup(driver);
    expect(backup.provenance).toMatchObject({ keymap: 'mirror', perKeyRgb: 'device' });
    await driver.restoreDefaults('keymap');
    expect(sim.state.keymapBase!.subarray(0, 574).every((b) => b === 0)).toBe(true);
    const plan = planRestore(backup, await driver.getDeviceInfo(), driver.getCapabilities());
    expect(plan.compatible).toBe(true);
    await applyBackup(driver, backup, plan);
    expect(Array.from(sim.state.keymapBase!.subarray(55 * 4, 55 * 4 + 2))).toEqual([5, 3]);
  });

  it('does not send START to an unrecognised product string without consent', async () => {
    const sim = new sonixFeature.SonixFeatureSimulator({ vendorId: 0x0c45, productId: 0x8009, productName: 'AK980 PRO' });
    await expect(
      connectKeyboard(sim.device.group(), { registry: createDefaultRegistry(), level: 'handshake', cmdDelayMs: 0, sleep: noSleep }),
    ).rejects.toSatisfy((e) => isOpenKeyError(e) && e.code === 'UNSUPPORTED_PROTOCOL' && e.details.awaitingConsent === true);
    expect(featureSets(sim)).toEqual([]);
  });

  it('blocks keymap writes on unrecognised product strings unless experimental', async () => {
    const { driver } = await setup(
      { vendorId: 0x0c45, productId: 0x8009, productName: 'AK980 PRO' },
      ['sonix-feature'],
    );
    await expect(
      driver.setKeymap({ layer: 'base', provenance: 'mirror', slots: {} }),
    ).rejects.toSatisfy((e) => isOpenKeyError(e) && e.code === 'SAFETY_BLOCKED');
  });

  it('refuses configuration over Bluetooth', async () => {
    const sim = new sonixFeature.SonixFeatureSimulator();
    const group = { ...sim.device.group(), transportHint: 'bluetooth' as const };
    const report = await createDefaultRegistry().detect(group, { level: 'descriptor' });
    expect(report.notes.join(' ')).toMatch(/Bluetooth/);
    const driver = await createDefaultRegistry()
      .get('sonix-feature')!
      .createDriver(group, {
        log: new (await import('@openkey/core')).PacketLog(),
        store: new MemoryStateStore(),
      });
    await expect(driver.connect()).rejects.toThrow(/Bluetooth/);
  });
});

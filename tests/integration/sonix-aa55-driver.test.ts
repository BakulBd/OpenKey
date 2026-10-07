import { describe, expect, it } from 'vitest';
import { Evidence, MemoryStateStore, isOpenKeyError } from '@openkey/core';
import {
  connectKeyboard,
  createDefaultRegistry,
  sonixAa55,
  sonixFeature,
} from '@openkey/protocols';
import { pattern, prepareFrame } from '@openkey/tft';
import { noSleep } from '../helpers.js';

async function setup(allowExperimental = false) {
  const sim = new sonixAa55.SonixAa55Simulator();
  const kb = await connectKeyboard(sim.device.group(), {
    registry: createDefaultRegistry(),
    level: 'handshake',
    store: new MemoryStateStore(),
    sleep: noSleep,
    allowExperimental,
  });
  return { sim, ...kb };
}

describe('online-driver protocol (sonix-aa55)', () => {
  it('builds frames exactly like ht()', () => {
    const f = sonixAa55.buildFrame(
      0x23,
      16,
      0x1234,
      Uint8Array.of(1, 2),
      64,
      undefined,
      undefined,
      true,
    );
    expect(Array.from(f.subarray(0, 10))).toEqual([0xaa, 0x23, 16, 0x34, 0x12, 0, 1, 0, 1, 2]);
    expect(f.length).toBe(64);
  });

  it('decodes GET_DEVICE_INFO like _n()', () => {
    const n = new Uint8Array(48);
    n[8] = 0x07;
    n[9] = 1;
    n[17] = 55;
    n[22] = 30;
    expect(sonixAa55.decodeDeviceInfo(n)).toMatchObject({
      version: '1.07',
      batteryLevel: 55,
      tftMaxFrames: 30,
    });
  });

  it('is selected for an online-protocol AK820 Pro and confirmed by GET_DEVICE_INFO', async () => {
    const { detection, driver } = await setup();
    expect(detection.selected).toMatchObject({
      protocolId: 'sonix-aa55',
      confidence: Evidence.VERIFIED,
    });
    const sf = detection.candidates.find((c) => c.protocol.id === 'sonix-feature')!;
    expect(sf.match.applicable).toBe(false);
    const info = await driver.getDeviceInfo();
    expect(info.firmware.version).toBe('1.07');
    expect(info.battery).toEqual({ level: 87, charging: false });
  });

  it('is rejected for the AK820 MAX topology (4096-byte FF68 data pipe)', async () => {
    const sim = new sonixFeature.SonixFeatureSimulator();
    const r = await createDefaultRegistry().detect(sim.device.group(), { level: 'descriptor' });
    const aa = r.candidates.find((c) => c.protocol.id === 'sonix-aa55')!;
    expect(aa.match.applicable).toBe(false);
    expect(aa.match.rejections[0]).toMatch(/4096 bytes/);
    expect(r.selected?.protocolId).toBe('sonix-feature');
    expect(sim.device.traffic).toHaveLength(0);
  });

  it('reads and writes keymap, lighting, per-key colours and macros from the device', async () => {
    const { driver } = await setup();
    await driver.setKeymap({
      layer: 'base',
      provenance: 'mirror',
      slots: { 48: { kind: 'keyboard', usage: 0x29, modifiers: 0 } },
    });
    expect((await driver.getKeymap('base')).slots[48]).toEqual({
      kind: 'keyboard',
      usage: 0x29,
      modifiers: 0,
    });
    expect((await driver.getKeymap('base')).provenance).toBe('device');
    await driver.setRgbConfig({
      effect: 7,
      color: { r: 1, g: 2, b: 3 },
      colorful: true,
      brightness: 4,
      speed: 2,
      direction: 'right',
    });
    expect(await driver.getRgbConfig()).toEqual({
      effect: 7,
      color: { r: 1, g: 2, b: 3 },
      colorful: true,
      brightness: 4,
      speed: 2,
      direction: 'right',
    });
    await driver.setPerKeyRgb({ 0: { r: 9, g: 8, b: 7 } });
    expect((await driver.getPerKeyRgb())[0]).toEqual({ r: 9, g: 8, b: 7 });
    const macros = [
      {
        index: 3,
        events: [
          { type: 'key' as const, usage: 4, down: true },
          { type: 'delay' as const, ms: 20 },
          { type: 'key' as const, usage: 4, down: false },
        ],
      },
    ];
    await driver.setMacros(macros);
    expect(await driver.getMacros()).toEqual(macros);
  });

  it('refuses blocked commands such as factory reset and OTA', async () => {
    const sim = new sonixAa55.SonixAa55Simulator();
    const t = await sim.device.group().openInterface(sim.device.group().interfaces[0]!);
    const link = new sonixAa55.Aa55Link(t);
    for (const cmd of [15, 79, 130])
      await expect(link.transfer({ cmd })).rejects.toSatisfy(
        (e) => isOpenKeyError(e) && e.code === 'SAFETY_BLOCKED',
      );
    expect(sim.device.traffic).toHaveLength(0);
  });

  it('gates the unverified TFT upload behind experimental mode', async () => {
    const { driver } = await setup();
    const info = await driver.getTftInfo();
    await expect(
      driver.uploadTftImage(prepareFrame(pattern('red', 128, 128), info)),
    ).rejects.toThrow(/experimental/);
    const exp = await setup(true);
    await exp.driver.uploadTftImage(prepareFrame(pattern('red', 128, 128), info));
    expect(exp.sim.tftChunks).toHaveLength(9);
    expect(Array.from(exp.sim.tftChunks[0]!.subarray(0, 8))).toEqual([
      0xaa, 80, 0, 0, 9, 0, 0x50, 0x06,
    ]);
    expect(Array.from(exp.sim.tftChunks[0]!.subarray(8, 11))).toEqual([1, 0, 0xff]);
  });
});

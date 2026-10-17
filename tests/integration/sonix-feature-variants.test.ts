import { describe, expect, it } from 'vitest';
import { MemoryStateStore, isOpenKeyError } from '@openkey/core';
import { connectKeyboard, createDefaultRegistry, sonixFeature } from '@openkey/protocols';
import { pattern, prepareFrame } from '@openkey/tft';
import { noSleep } from '../helpers.js';

async function setup(productName: string, productId = 0x800a, consent?: string[]) {
  const sim = new sonixFeature.SonixFeatureSimulator({ vendorId: 0x0c45, productId, productName });
  const kb = await connectKeyboard(sim.device.group(), {
    registry: createDefaultRegistry(),
    level: 'handshake',
    ...(consent ? { consent } : {}),
    store: new MemoryStateStore(),
    cmdDelayMs: 0,
    sleep: noSleep,
    allowExperimental: true,
  });
  return { sim, ...kb };
}

const dataTraffic = (sim: InstanceType<typeof sonixFeature.SonixFeatureSimulator>) =>
  sim.device.traffic.filter((t) => t.op === 'output');

describe('AJAZZ-protocol models with other screens', () => {
  it('recognises the AULA F108 Pro by its product string, with its 240×135 screen and 104 keys', async () => {
    const { detection, driver } = await setup('AULA F108Pro');
    expect(detection.selected).toMatchObject({
      protocolId: 'sonix-feature',
      identification: 'identified',
    });
    const info = await driver.getTftInfo();
    expect(info).toMatchObject({ width: 240, height: 135, maxFrames: 141 });
    expect(info.geometryChoices).toBeUndefined();
    const layout = driver.getLayout();
    expect(layout.keys).toHaveLength(104);
    expect(layout.keys.find((k) => k.id === 'Esc')).toMatchObject({
      slot: 1,
      light: 1,
      usage: 0x29,
    });
    expect(layout.keys.find((k) => k.id === 'KPEnter')?.light).toBe(106);
    expect((await driver.getDeviceInfo()).model).toBe('AULA F108 Pro');
  });

  it('uploads a 240×135 picture and never sends more frames than the F108 Pro holds', async () => {
    const { driver, sim } = await setup('AULA F108Pro');
    const info = await driver.getTftInfo();
    await driver.uploadTftImage(prepareFrame(pattern('red', 240, 135), info));
    expect(dataTraffic(sim)).toHaveLength(16);
    const frame = prepareFrame(pattern('blue', 240, 135), info);
    const before = dataTraffic(sim).length;
    await driver.uploadTftGif(Array.from({ length: 142 }, () => ({ ...frame, delayMs: 100 })));
    const sent = dataTraffic(sim).slice(before);
    // Trimmed to 141 frames: the header says so, and 256 + 141 × 64 800 bytes need 2 231 chunks.
    expect(sent[0]!.data[0]).toBe(141);
    expect(sent).toHaveLength(2231);
  });

  it('makes an unrecognised model choose its screen size before any upload', async () => {
    const { driver, sim } = await setup('USB KEYBOARD', 0x8009, ['sonix-feature']);
    const info = await driver.getTftInfo();
    expect(info.geometryChoices?.map((g) => g.id)).toEqual(['128x128', '240x135']);
    expect(info.geometryId).toBeUndefined();
    await expect(
      driver.uploadTftImage(prepareFrame(pattern('red', info.width, info.height), info)),
    ).rejects.toSatisfy((e) => isOpenKeyError(e) && e.code === 'SAFETY_BLOCKED');
    expect(dataTraffic(sim)).toEqual([]);

    await driver.setTftGeometry('240x135');
    const chosen = await driver.getTftInfo();
    expect(chosen).toMatchObject({
      width: 240,
      height: 135,
      maxFrames: 141,
      geometryId: '240x135',
    });
    await driver.uploadTftImage(prepareFrame(pattern('green', 240, 135), chosen));
    expect(dataTraffic(sim)).toHaveLength(16);
    await expect(driver.setTftGeometry('999x1')).rejects.toThrow();
  });

  it('keeps the known AK820 MAX screen fixed', async () => {
    const { driver } = await setup('AK820 MAX', 0x8009);
    expect((await driver.getTftInfo()).geometryChoices).toBeUndefined();
    await expect(driver.setTftGeometry('240x135')).rejects.toThrow();
  });
});

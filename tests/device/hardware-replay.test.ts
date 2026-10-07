import { describe, expect, it } from 'vitest';
import { Confidence, MemoryStateStore, PacketLog } from '@openak820/core';
import { MockHidDevice, replayBehavior } from '@openak820/hid';
import type { RecordedPacket } from '@openak820/hid';
import { createDefaultRegistry, sonixFeature } from '@openak820/protocols';
import { fixture, noSleep } from '../helpers.js';

/** Replays captures from the physical AK820 MAX PLUS (fixtures/*-hw.json). */
function deviceFrom(packets: RecordedPacket[]) {
  const ifs = sonixFeature.sonixFeatureInterfaces();
  const behavior = replayBehavior(packets);
  const dev = new MockHidDevice(
    {
      vendorId: 0x0c45,
      productId: 0x8009,
      productName: 'AK820 MAX',
      manufacturer: 'SONiX',
      release: 0x0107,
    },
    [
      { info: ifs.data, behavior: {} },
      { info: ifs.control, behavior },
    ],
  );
  return { dev, behavior };
}

describe('hardware replay: AK820 MAX PLUS', () => {
  it('START handshake capture yields a CONFIRMED detection', async () => {
    const fx = fixture<{ packets: RecordedPacket[] }>(
      'device-info/ak820-max-plus-start-handshake-hw.json',
    );
    const { dev, behavior } = deviceFrom(fx.packets);
    const report = await createDefaultRegistry().detect(dev.group(), { level: 'handshake' });
    expect(report.selected).toMatchObject({
      protocolId: 'sonix-feature',
      confidence: Confidence.CONFIRMED,
    });
    expect(behavior.remaining()).toBe(0);
  });

  it('per-key read capture decodes to the colours stored on the device', async () => {
    const fx = fixture<{ packets: RecordedPacket[]; expected: { litEntries: number[] } }>(
      'rgb/ak820-max-plus-read-per-key-hw.json',
    );
    const { dev, behavior } = deviceFrom(fx.packets);
    const driver = await createDefaultRegistry().get('sonix-feature')!.createDriver(dev.group(), {
      log: new PacketLog(),
      store: new MemoryStateStore(),
      sleep: noSleep,
      cmdDelayMs: 0,
    });
    await driver.connect();
    const colors = await driver.getPerKeyRgb();
    expect(behavior.remaining()).toBe(0);
    for (const led of fx.expected.litEntries)
      expect(colors[led]).toEqual({ r: 0x1f, g: 0x2f, b: 0x2f });
    expect(colors[1]).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('the read-back table carries its own slot index in every entry', () => {
    const fx = fixture<{ packets: RecordedPacket[] }>('rgb/ak820-max-plus-read-per-key-hw.json');
    const table = Uint8Array.from(
      fx.packets.slice(2, 11).flatMap((p) => p.hex.split(' ').map((h) => parseInt(h, 16))),
    );
    expect(
      sonixFeature.perKeyTableLooksValid(
        table,
        Array.from({ length: 144 }, (_, i) => i),
      ).ok,
    ).toBe(true);
  });
});

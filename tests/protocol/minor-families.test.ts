import { describe, expect, it } from 'vitest';
import { MockHidDevice } from '@openkey/hid';
import { createDefaultRegistry, crs, qmkVia, sonixDongle } from '@openkey/protocols';

describe('2.4 GHz receiver protocol', () => {
  it('appends the additive checksum seen in mrworldwide captures', () => {
    expect(Array.from(sonixDongle.donglePacket([0x20, 0x01]))).toEqual([
      0x20,
      0x01,
      ...new Array(29).fill(0),
      0x21,
    ]);
    expect(sonixDongle.donglePacket([0x02]).at(-1)).toBe(0x02);
  });

  it('builds the official 2.4 GHz lighting packet (FUN_0042b2a0)', () => {
    const p = sonixDongle.dongleLightingPacket({
      effect: 6,
      color: { r: 255, g: 255, b: 255 },
      colorful: false,
      brightness: 3,
      speed: 2,
      direction: 'left',
    });
    expect(Array.from(p.subarray(0, 19))).toEqual([
      5, 0x10, 0, 6, 255, 255, 255, 0, 0, 0, 0, 0, 3, 2, 0, 0, 0, 0xaa, 0x55,
    ]);
  });

  it('is only a candidate for receiver identities', async () => {
    const coll = {
      usagePage: 0xff60,
      usage: 0x61,
      inputReports: [{ reportId: 0, size: 32 }],
      outputReports: [{ reportId: 0, size: 32 }],
      featureReports: [],
    };
    const dongle = new MockHidDevice(
      { vendorId: 0x0c45, productId: 0xfdfd, productName: '2.4G Dongle' },
      [{ info: { collections: [coll] }, behavior: {} }],
      '2.4ghz',
    );
    const r = await createDefaultRegistry().detect(dongle.group());
    expect(r.selected?.protocolId).toBe('sonix-dongle');
    expect(r.candidates.find((c) => c.protocol.id === 'qmk-via')!.match.applicable).toBe(false);
  });
});

describe('QMK / VIA', () => {
  it('confirms a VIA board with id_get_protocol_version', async () => {
    const coll = {
      usagePage: 0xff60,
      usage: 0x61,
      inputReports: [{ reportId: 0, size: 32 }],
      outputReports: [{ reportId: 0, size: 32 }],
      featureReports: [],
    };
    const dev = new MockHidDevice(
      { vendorId: 0x0c45, productId: 0x8009, productName: 'AK820 Pro' },
      [
        {
          info: { collections: [coll] },
          behavior: {
            onOutput: (_i, d, ctx) =>
              ctx.emitInput(Uint8Array.of(d[0]!, 0x00, 0x0c, ...new Array(29).fill(0))),
          },
        },
      ],
    );
    const r = await createDefaultRegistry().detect(dev.group(), { level: 'handshake' });
    expect(r.selected).toMatchObject({ protocolId: 'qmk-via', confidence: 'CONFIRMED' });
    expect(qmkVia.qmkViaProtocol.id).toBe('qmk-via');
  });
});

describe('CRS AK820 Max Plus', () => {
  it('frames packets with AA 55 CC 33', () => {
    expect(Array.from(crs.crsPacket(crs.CrsOp.HEARTBEAT).subarray(0, 6))).toEqual([
      0xaa, 0x55, 0xcc, 0x33, 0x0e, 0,
    ]);
    expect(crs.nearestCrsColor({ r: 250, g: 10, b: 10 }, false)).toBe(0);
    expect(crs.nearestCrsColor({ r: 0, g: 0, b: 0 }, true)).toBe(7);
  });

  it('never performs I/O during detection', async () => {
    const coll = {
      usagePage: 0xff02,
      usage: 0x01,
      inputReports: [{ reportId: 0, size: 64 }],
      outputReports: [{ reportId: 0, size: 64 }],
      featureReports: [],
    };
    const dev = new MockHidDevice(
      { vendorId: 0x1a2c, productId: 0xa036, productName: 'USB KEYBOARD' },
      [{ info: { collections: [coll] }, behavior: {} }],
    );
    const r = await createDefaultRegistry().detect(dev.group(), { level: 'handshake' });
    expect(r.selected).toMatchObject({ protocolId: 'crs-aa55cc33', confidence: 'INFERRED' });
    expect(dev.traffic).toHaveLength(0);
  });
});

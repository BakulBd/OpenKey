import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import { Feature, LONG_ID } from './protocol.js';

/**
 * A Logitech G keyboard on HID++ 2.0: root ping and getFeature, device name, unified battery, RGB
 * effects (software control) and per-key lighting. Feature indices are the simulator's own, so tests
 * prove the adapter looks them up instead of assuming them.
 */
export class LogitechSimulator {
  readonly device: MockHidDevice;
  readonly calls: { index: number; fn: number; params: number[] }[] = [];
  readonly zones = new Map<number, [number, number, number]>();
  frames = 0;
  swControl = 0;
  onboardMode = 1;
  private readonly index = new Map<number, number>([
    [Feature.DEVICE_NAME, 3],
    [Feature.UNIFIED_BATTERY, 7],
    [Feature.RGB_EFFECTS, 12],
    [Feature.PER_KEY_LIGHTING_V2, 13],
    [Feature.ONBOARD_PROFILES, 15],
  ]);
  readonly name = 'G915 TKL LIGHTSPEED';

  constructor(
    identity: DeviceIdentity = { vendorId: 0x046d, productId: 0xc343, productName: 'G915 TKL' },
    opts: { perKey?: boolean } = {},
  ) {
    if (opts.perKey === false) this.index.delete(Feature.PER_KEY_LIGHTING_V2);
    this.device = new MockHidDevice(identity, [
      {
        info: {
          collections: [
            {
              usagePage: 0x01,
              usage: 0x06,
              inputReports: [],
              outputReports: [],
              featureReports: [],
            },
          ],
        },
        behavior: {},
      },
      {
        info: {
          collections: [
            {
              usagePage: 0xff00,
              usage: 0x02,
              inputReports: [{ reportId: LONG_ID, size: 19 }],
              outputReports: [{ reportId: LONG_ID, size: 19 }],
              featureReports: [],
            },
          ],
        },
        behavior: { onOutput: (_id, d, ctx) => ctx.emitInput(this.answer(d)) },
      },
    ]);
  }

  private answer(d: Uint8Array): Uint8Array {
    const [dev, index, fs] = [d[0]!, d[1]!, d[2]!];
    const fn = fs >> 4;
    const p = [...d.subarray(3)];
    this.calls.push({ index, fn, params: p });
    const r = new Uint8Array(19);
    r.set([dev, index, fs]);
    const out = (bytes: number[]) => (r.set(bytes, 3), r);
    if (index === 0 && fn === 1) return out([4, 2, p[2]!]);
    if (index === 0 && fn === 0) {
      const id = (p[0]! << 8) | p[1]!;
      return out([this.index.get(id) ?? 0]);
    }
    const feature = [...this.index].find(([, i]) => i === index)?.[0];
    if (feature === Feature.DEVICE_NAME && fn === 0) return out([this.name.length]);
    if (feature === Feature.DEVICE_NAME && fn === 1)
      return out([...new TextEncoder().encode(this.name.slice(p[0]!, p[0]! + 16))]);
    if (feature === Feature.UNIFIED_BATTERY && fn === 1) return out([76, 4, 0]);
    if (feature === Feature.RGB_EFFECTS && fn === 5) this.swControl = p[1]!;
    if (feature === Feature.ONBOARD_PROFILES && fn === 1) this.onboardMode = p[0]!;
    if (feature === Feature.PER_KEY_LIGHTING_V2 && fn === 1)
      for (let i = 0; i + 3 < 16; i += 4)
        if (p[i]) this.zones.set(p[i]!, [p[i + 1]!, p[i + 2]!, p[i + 3]!]);
    if (feature === Feature.PER_KEY_LIGHTING_V2 && fn === 7) this.frames++;
    if (feature === undefined) {
      const e = new Uint8Array(19);
      e.set([dev, 0xff, index, fs, 0x02]);
      return e;
    }
    return r;
  }
}

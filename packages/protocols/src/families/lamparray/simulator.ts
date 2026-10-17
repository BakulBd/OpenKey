import type { DeviceIdentity } from '@openkey/core';
import { getLayout } from '@openkey/devices';
import { MockHidDevice } from '@openkey/hid';
import type { HidCollection } from '@openkey/hid';
import { LIGHTING_PAGE, SIZE, Usage } from './codec.js';

/** Report IDs of Microsoft's reference LampArray descriptor. */
export const REFERENCE_IDS = {
  attributes: 1,
  request: 2,
  response: 3,
  multi: 4,
  range: 5,
  control: 6,
} as const;
/** The reference descriptor carries 8 lamps per multi-update report. */
export const REFERENCE_CAPACITY = 8;

export interface SimLamp {
  binding: number;
  x: number;
  y: number;
  purposes?: number;
  programmable?: boolean;
  levels?: number;
}

/** A small keyboard: three keys of the top row, three of the home row, a space bar, and a logo. */
export const SAMPLE_LAMPS: readonly SimLamp[] = [
  { binding: 0x29, x: 9525, y: 9525 },
  { binding: 0x14, x: 38100, y: 47625 },
  { binding: 0x1a, x: 57150, y: 47625 },
  { binding: 0x04, x: 42863, y: 66675 },
  { binding: 0x16, x: 61913, y: 66675 },
  { binding: 0x07, x: 80963, y: 66675 },
  { binding: 0x2c, x: 133350, y: 104775 },
  { binding: 0, x: 266700, y: 9525, purposes: 0x04 },
  { binding: 0x39, x: 14288, y: 66675, programmable: false },
];

/** A full 75% keyboard for the demo: every key of the AK820 Pro layout, plus a three-lamp accent bar. */
export function demoLamps(): SimLamp[] {
  const u = 19050;
  const keys = getLayout('ak820-pro').keys.map((k) => ({
    binding: k.usage,
    x: Math.round((k.x + k.w / 2) * u),
    y: Math.round((k.y + k.h / 2) * u),
  }));
  const accent = [0, 1, 2].map((i) => ({ binding: 0, x: (14 + i) * u, y: 7 * u, purposes: 0x02 }));
  return [...keys, ...accent];
}

const child = (usage: number, kind: 'feature' | 'input', reportId: number, size: number) => ({
  usagePage: LIGHTING_PAGE,
  usage,
  inputReports: kind === 'input' ? [{ reportId, size }] : [],
  outputReports: [],
  featureReports: kind === 'feature' ? [{ reportId, size }] : [],
});

/** The LampArray collection as WebHID and the Linux descriptor parser present it. */
export function lampArrayCollection(capacity = REFERENCE_CAPACITY): HidCollection {
  const ids = REFERENCE_IDS;
  const children = [
    child(Usage.ATTRIBUTES_REPORT, 'feature', ids.attributes, SIZE.attributes),
    child(Usage.ATTRIBUTES_REQUEST, 'feature', ids.request, SIZE.request),
    child(Usage.ATTRIBUTES_RESPONSE, 'feature', ids.response, SIZE.response),
    child(Usage.MULTI_UPDATE, 'feature', ids.multi, 2 + capacity * 6),
    child(Usage.RANGE_UPDATE, 'feature', ids.range, SIZE.range),
    child(Usage.CONTROL, 'feature', ids.control, SIZE.control),
  ];
  return {
    usagePage: LIGHTING_PAGE,
    usage: Usage.LAMP_ARRAY,
    inputReports: [],
    outputReports: [],
    featureReports: children.flatMap((c) => c.featureReports),
    children,
  };
}

/**
 * A keyboard implementing HID LampArray as the standard describes it: attributes, lamp attributes
 * that advance after each read (or not, with `autoAdvance: false`), multi/range updates and the
 * autonomous-mode control. Lamp colours are kept so tests can check what the keyboard shows.
 */
export class LampArraySimulator {
  readonly device: MockHidDevice;
  autonomous = true;
  readonly colors = new Map<number, [number, number, number, number]>();
  readonly frames: number[] = [];
  private next = 0;

  constructor(
    readonly lamps: readonly SimLamp[] = SAMPLE_LAMPS,
    opts: { identity?: DeviceIdentity; autoAdvance?: boolean; capacity?: number } = {},
  ) {
    const capacity = opts.capacity ?? REFERENCE_CAPACITY;
    const autoAdvance = opts.autoAdvance ?? true;
    const ids = REFERENCE_IDS;
    this.device = new MockHidDevice(
      opts.identity ?? { vendorId: 0x045e, productId: 0x0b4f, productName: 'LampArray Keyboard' },
      [
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
          info: { collections: [lampArrayCollection(capacity)] },
          behavior: {
            onFeatureSet: (id, d) => {
              const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
              if (id === ids.request) this.next = v.getUint16(0, true);
              else if (id === ids.control) this.autonomous = d[0] === 1;
              else if (id === ids.range && !this.autonomous) {
                for (let l = v.getUint16(1, true); l <= v.getUint16(3, true); l++)
                  this.set(l, [d[5]!, d[6]!, d[7]!, d[8]!]);
                if (d[0]! & 1) this.frames.push(Date.now());
              } else if (id === ids.multi && !this.autonomous) {
                for (let k = 0; k < d[0]!; k++)
                  this.set(v.getUint16(2 + k * 2, true), [
                    ...d.subarray(2 + capacity * 2 + k * 4, 6 + capacity * 2 + k * 4),
                  ] as [number, number, number, number]);
                if (d[1]! & 1) this.frames.push(Date.now());
              }
            },
            onFeatureGet: (id) => {
              if (id === ids.attributes) return this.attributes();
              if (id === ids.response) {
                const r = this.lamp(this.next);
                if (autoAdvance) this.next = (this.next + 1) % this.lamps.length;
                return r;
              }
              return new Uint8Array(0);
            },
          },
        },
      ],
    );
  }

  private set(id: number, c: [number, number, number, number]): void {
    const lamp = this.lamps[id];
    if (lamp && lamp.programmable !== false) this.colors.set(id, c);
  }

  private attributes(): Uint8Array {
    const out = new Uint8Array(SIZE.attributes);
    const v = new DataView(out.buffer);
    v.setUint16(0, this.lamps.length, true);
    v.setUint32(2, 285750, true);
    v.setUint32(6, 114300, true);
    v.setUint32(10, 30000, true);
    v.setUint32(14, 1, true);
    v.setUint32(18, 8000, true);
    return out;
  }

  private lamp(id: number): Uint8Array {
    const l = this.lamps[id]!;
    const out = new Uint8Array(SIZE.response);
    const v = new DataView(out.buffer);
    v.setUint16(0, id, true);
    v.setUint32(2, l.x, true);
    v.setUint32(6, l.y, true);
    v.setUint32(10, 0, true);
    v.setUint32(14, 4000, true);
    v.setUint32(18, l.purposes ?? 0x01, true);
    const lv = l.levels ?? 255;
    out.set([lv, lv, lv, 1, l.programmable === false ? 0 : 1, l.binding], 22);
    return out;
  }
}

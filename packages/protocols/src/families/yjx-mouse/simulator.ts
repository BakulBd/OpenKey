import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import { Field, REPORT_SIZE, YJX_USAGE_PAGE } from './codec.js';

/**
 * The AJ139 V2 MC as the public protocol reference describes it: a settings block read with
 * 55 0e a5 and replaced with 55 0f ae, an info string and a battery query. Byte 30 holds an
 * undocumented value, so tests can prove a write keeps bytes OpenKey does not know.
 */
export class YjxMouseSimulator {
  readonly device: MockHidDevice;
  readonly block = new Uint8Array(REPORT_SIZE);
  readonly writes: Uint8Array[] = [];
  battery = 87;

  constructor(identity?: DeviceIdentity) {
    const b = this.block;
    b[Field.LIGHT] = 2;
    b[Field.RATE] = 4; // 1000 Hz
    b[Field.DPI_COUNT] = 6;
    b[Field.DPI_INDEX] = 2;
    [400, 800, 1200, 1600, 2400, 3200].forEach((d, i) => {
      b[Field.DPI + i * 2] = d & 0xff;
      b[Field.DPI + i * 2 + 1] = d >> 8;
    });
    b[30] = 0x77;
    b[Field.LIFT_OFF] = 1;
    b[Field.SENSOR] = 53;
    b[Field.DEBOUNCE] = 4;
    b[Field.SLEEP] = 10;
    this.device = new MockHidDevice(
      identity ?? { vendorId: 0xa8a4, productId: 0x2255, productName: 'AJ139 V2 MC' },
      [
        {
          info: {
            collections: [
              {
                usagePage: 0x01,
                usage: 0x02,
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
                usagePage: YJX_USAGE_PAGE,
                usage: 0x01,
                inputReports: [{ reportId: 0, size: REPORT_SIZE }],
                outputReports: [{ reportId: 0, size: REPORT_SIZE }],
                featureReports: [],
              },
            ],
          },
          behavior: { onOutput: (_id, d, ctx) => ctx.emitInput(this.onRequest(d)) },
        },
      ],
    );
  }

  private onRequest(d: Uint8Array): Uint8Array {
    const r = new Uint8Array(REPORT_SIZE);
    r.set([0xaa, d[1]!, d[2]!, 0x00]);
    if (d[0] !== 0x55) return r;
    if (d[1] === 0x0e && d[2] === 0xa5) {
      r.set(this.block.subarray(4), 4);
      r.set([0x2f, 0x01, 0x01, 0x00, 0x00], 4);
    } else if (d[1] === 0x0f && d[2] === 0xae) {
      this.writes.push(d.slice());
      this.block.set(d.subarray(9), 9);
      r.set(this.block.subarray(4), 4);
      r.set([0x2f, 0x01, 0x01, 0x00, 0x00], 4);
    } else if (d[1] === 0x30) r.set([0x0a, 0x01, 0x01, 0x00, this.battery], 4);
    else if (d[1] === 0x03) {
      r.set([0x38, 0x00, 0x00, 0x00], 4);
      r.set(new TextEncoder().encode('YJX.co.mouse271220Nov 12'), 8);
    }
    return r;
  }
}

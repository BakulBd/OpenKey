import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import { REPORT_BYTES } from './models.js';
import { Status, crc } from './driver.js';

/**
 * A Razer keyboard's control collection: answers each 90-byte command with status 02 (or 01 busy
 * once, to exercise the retry), keeps brightness, the last effect command and the custom frame.
 */
export class RazerSimulator {
  readonly device: MockHidDevice;
  brightness = 200;
  effect: number[] = [];
  readonly frame = new Map<number, number[]>();
  readonly commands: Uint8Array[] = [];
  busyOnce = true;
  private answer: Uint8Array = new Uint8Array(REPORT_BYTES);

  constructor(
    identity: DeviceIdentity = {
      vendorId: 0x1532,
      productId: 0x024e,
      productName: 'Razer BlackWidow V3',
    },
  ) {
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
              usagePage: 0x01,
              usage: 0x02,
              inputReports: [],
              outputReports: [],
              featureReports: [{ reportId: 0, size: REPORT_BYTES }],
            },
          ],
        },
        behavior: {
          onFeatureSet: (_id, d) => {
            this.commands.push(d.slice());
            this.answer = this.handle(d);
          },
          onFeatureGet: () => {
            if (this.busyOnce) {
              this.busyOnce = false;
              const busy = this.answer.slice();
              busy[0] = Status.BUSY;
              return busy;
            }
            return this.answer;
          },
        },
      },
    ]);
  }

  private handle(d: Uint8Array): Uint8Array {
    const r = d.slice();
    r[0] = d[88] === crc(d) ? Status.OK : Status.FAILED;
    const [cls, id] = [d[6]!, d[7]!];
    const args = [...d.subarray(8, 8 + d[5]!)];
    if (cls === 0x00 && id === 0x81) r.set([1, 4], 8);
    else if ((cls === 0x0f && id === 0x84) || (cls === 0x03 && id === 0x83))
      r[10] = this.brightness;
    else if ((cls === 0x0f && id === 0x04) || (cls === 0x03 && id === 0x03))
      this.brightness = args[2]!;
    else if ((cls === 0x0f && id === 0x02) || (cls === 0x03 && id === 0x0a)) this.effect = args;
    else if (cls === 0x0f && id === 0x03) this.frame.set(args[2]!, args.slice(5));
    else if (cls === 0x03 && id === 0x0b) this.frame.set(args[1]!, args.slice(4));
    else r[0] = Status.UNSUPPORTED;
    r[88] = crc(r);
    return r;
  }
}

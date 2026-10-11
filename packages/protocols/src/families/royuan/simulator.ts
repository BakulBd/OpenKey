import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import type { MockBehavior } from '@openkey/hid';
import { Cmd, REPORT_BYTES, USAGE_PAGE } from './constants.js';
import type { RoyuanFamily } from './driver.js';

/** A ROYUAN firmware as far as identify, revision and lighting go; unknown commands replay the last reply. */
export class RoyuanSimulator {
  readonly device: MockHidDevice;
  /** [mode, speed(wire), brightness, option<<4|flags, R, G, B] */
  led = [4, 3, 4, 0x07, 255, 0, 128];
  readonly sent: number[] = [];
  private reply = new Uint8Array(REPORT_BYTES);

  constructor(
    readonly family: RoyuanFamily = 'yc500',
    readonly deviceId = 3056,
    identity: DeviceIdentity = { vendorId: 0x3151, productId: 0x4015, productName: 'AK820 MAX HE' },
  ) {
    const behavior: MockBehavior = {
      onFeatureSet: (_id, d) => {
        this.sent.push(d[0]!);
        const r = this.reply.slice();
        switch (d[0]) {
          case Cmd.IDENTIFY:
            r.fill(0);
            r.set([0x8f, deviceId & 0xff, (deviceId >> 8) & 0xff, (deviceId >> 16) & 0xff, deviceId >>> 24]);
            if (family === 'gen2') r.set([0x13, 0x01], 7);
            break;
          case Cmd.REVISION:
            r.fill(0);
            if (family === 'yc500') r.set([0x80, 0x13, 0x01]);
            break;
          case Cmd.GET_LEDPARAM:
            r.fill(0);
            r.set([0x87, ...this.led]);
            break;
          case Cmd.SET_LEDPARAM:
            this.led = Array.from(d.subarray(1, 8));
            break;
          default:
            // Unknown command: the previous reply stays.
            break;
        }
        this.reply = r;
      },
      onFeatureGet: () => this.reply.slice(),
    };
    this.device = new MockHidDevice(identity, [
      { info: { interfaceNumber: 0, collections: [{ usagePage: 1, usage: 6, inputReports: [{ reportId: 0, size: 8 }], outputReports: [], featureReports: [] }] }, behavior: {} },
      { info: { interfaceNumber: 2, collections: [{ usagePage: USAGE_PAGE, usage: 2, inputReports: [], outputReports: [], featureReports: [{ reportId: 0, size: REPORT_BYTES }] }] }, behavior },
    ]);
  }
}

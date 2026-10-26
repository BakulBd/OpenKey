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
  /** Base and Fn slot tables (128 × 4 bytes) of the active profile. */
  readonly base = new Uint8Array(512);
  readonly fn = new Uint8Array(512);
  /** Some yc500 firmware drops single-slot writes; set to emulate it. */
  dropSlotWrites = false;
  /** gen2 key-map write packets, in order. */
  readonly gen2Writes: Uint8Array[] = [];

  constructor(
    readonly family: RoyuanFamily = 'yc500',
    readonly deviceId = 3056,
    identity: DeviceIdentity = { vendorId: 0x3151, productId: 0x4015, productName: 'AK820 MAX HE' },
  ) {
    // A small board: slots 0..29 type A, B, C …; slot 30 is volume up; the rest are empty.
    for (let i = 0; i < 30; i++) this.base.set([0x00, 0x00, 0x04 + (i % 26), 0x00], i * 4);
    this.base.set([0x03, 0x00, 0xe9, 0x00], 30 * 4);
    const behavior: MockBehavior = {
      onFeatureSet: (_id, d) => {
        this.sent.push(d[0]!);
        const r = this.reply.slice();
        switch (d[0]) {
          case Cmd.IDENTIFY:
            r.fill(0);
            r.set([
              0x8f,
              deviceId & 0xff,
              (deviceId >> 8) & 0xff,
              (deviceId >> 16) & 0xff,
              deviceId >>> 24,
            ]);
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
          case Cmd.GET_PROFILE_YC500:
          case Cmd.GET_PROFILE_GEN2:
            r.fill(0);
            r.set([d[0]!, 1]);
            break;
          case Cmd.GET_KEYMAP_YC500:
          case Cmd.GET_FN_YC500:
            if (family !== 'yc500') break;
            r.set(
              (d[0] === Cmd.GET_FN_YC500 ? this.fn : this.base).subarray(
                d[2]! * 64,
                d[2]! * 64 + 64,
              ),
            );
            break;
          case Cmd.GET_KEYMAP_GEN2:
            if (family === 'yc500') {
              r.fill(0xff);
              break;
            }
            r.set(this.base.subarray(d[3]! * 64, d[3]! * 64 + 64));
            break;
          case Cmd.SET_KEYMAP_GEN2:
            // [0A, profile, FF, page, length, last, layer, ck] + data from byte 8
            if (family === 'gen2' && d[6] === 0 && !this.dropSlotWrites) {
              this.gen2Writes.push(d.slice());
              this.base.set(d.subarray(8, 8 + d[4]!), d[3]! * 56);
            }
            break;
          case Cmd.SET_KEY_YC500:
          case Cmd.SET_FN_KEY_YC500:
            if (family === 'yc500' && !this.dropSlotWrites)
              (d[0] === Cmd.SET_FN_KEY_YC500 ? this.fn : this.base).set(
                d.subarray(8, 12),
                d[2]! * 4,
              );
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
      {
        info: {
          interfaceNumber: 0,
          collections: [
            {
              usagePage: 1,
              usage: 6,
              inputReports: [{ reportId: 0, size: 8 }],
              outputReports: [],
              featureReports: [],
            },
          ],
        },
        behavior: {},
      },
      {
        info: {
          interfaceNumber: 2,
          collections: [
            {
              usagePage: USAGE_PAGE,
              usage: 2,
              inputReports: [],
              outputReports: [],
              featureReports: [{ reportId: 0, size: REPORT_BYTES }],
            },
          ],
        },
        behavior,
      },
    ]);
  }
}

import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import { REPORT_BYTES, REPORT_ID, USAGE_PAGE } from './protocol.js';

/** An EVision board's vendor channel: answers every packet, keeps parameters and the colour table. */
export class EVisionSimulator {
  readonly device: MockHidDevice;
  readonly packets: Uint8Array[] = [];
  params = new Uint8Array(8);
  readonly colors = new Uint8Array(0x36 * 7);

  constructor(
    identity: DeviceIdentity = {
      vendorId: 0x0c45,
      productId: 0x5204,
      productName: 'USB-HID Gaming Keyboard',
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
              usagePage: USAGE_PAGE,
              usage: 0x01,
              inputReports: [{ reportId: REPORT_ID, size: REPORT_BYTES }],
              outputReports: [{ reportId: REPORT_ID, size: REPORT_BYTES }],
              featureReports: [],
            },
          ],
        },
        behavior: {
          onOutput: (_id, d, ctx) => {
            this.packets.push(d.slice());
            let sum = 0;
            for (let i = 2; i < REPORT_BYTES; i++) sum += d[i]!;
            if ((sum & 0xff) !== d[0] || ((sum >> 8) & 0xff) !== d[1]) return;
            const size = d[3]!;
            const off = d[4]! | (d[5]! << 8);
            if (d[2] === 0x06) this.params.set(d.subarray(7, 7 + size), d[4]!);
            if (d[2] === 0x11) this.colors.set(d.subarray(7, 7 + size), off);
            ctx.emitInput(d.slice());
          },
        },
      },
    ]);
  }
}

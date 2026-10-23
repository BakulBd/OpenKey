import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import { REPORT_BYTES, REPORT_ID, USAGE, USAGE_PAGE } from './protocol.js';

/** The MK870's interfaces as its owner's support bundle shows them; every packet is kept. */
export class WinbondSimulator {
  readonly device: MockHidDevice;
  readonly packets: Uint8Array[] = [];
  /** Whether the simulated keyboard answers the lighting query (tests both outcomes). */
  answersQueries = true;
  /** Last lighting record written (`07 00 …`); starts as static red at full brightness. */
  lighting = Uint8Array.from([
    0x07,
    0x00,
    0x00,
    0x00,
    0x0e,
    0x00,
    0x04,
    0x02,
    0xff,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff,
    0x02,
    0x00,
    ...new Array(47).fill(0),
  ]);

  constructor(
    identity: DeviceIdentity = {
      vendorId: 0x0416,
      productId: 0xc345,
      productName: 'Gaming Keyboard',
    },
  ) {
    this.device = new MockHidDevice(identity, [
      {
        info: {
          collections: [
            {
              usagePage: 0x0c,
              usage: 0x01,
              inputReports: [{ reportId: 2, size: 3 }],
              outputReports: [],
              featureReports: [],
            },
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
              usagePage: USAGE_PAGE,
              usage: USAGE,
              inputReports: [{ reportId: REPORT_ID, size: REPORT_BYTES }],
              outputReports: [{ reportId: REPORT_ID, size: REPORT_BYTES }],
              featureReports: [],
            },
          ],
        },
        behavior: {
          onOutput: (_id, d, ctx) => {
            this.packets.push(d);
            if (d[0] === 0x07 && d[1] === 0x00) this.lighting = d.slice();
            // Key-map packets are acknowledged with an echo of the command (official driver).
            if (d[0] === 0x18) {
              const ack = new Uint8Array(REPORT_BYTES);
              ack.set(d.subarray(0, 5));
              ctx.emitInput(ack);
            }
            // Lighting query: answers with the lighting record, as the official driver reads it.
            if (this.answersQueries && d[0] === 0x07 && d[1] === 0x01) {
              const r = this.lighting.slice();
              r[1] = 0x01;
              ctx.emitInput(r);
            }
          },
        },
      },
    ]);
  }
}

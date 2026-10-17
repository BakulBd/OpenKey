import { MockHidDevice } from '@openkey/hid';
import { REPORT_BYTES, REPORT_ID } from './protocol.js';

/** The AK992 config channel: feature report 7 on FF01:0001; every packet is kept for tests. */
export class SemicoSimulator {
  readonly device: MockHidDevice;
  readonly packets: Uint8Array[] = [];

  constructor() {
    this.device = new MockHidDevice(
      {
        vendorId: 0x1a2c,
        productId: 0x9c00,
        productName: 'Gaming Keyboard',
        manufacturer: 'SEMICO',
      },
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
          info: {
            collections: [
              {
                usagePage: 0xff01,
                usage: 0x01,
                inputReports: [],
                outputReports: [{ reportId: REPORT_ID, size: REPORT_BYTES }],
                featureReports: [{ reportId: REPORT_ID, size: REPORT_BYTES }],
              },
            ],
          },
          behavior: { onFeatureSet: (_id, d) => void this.packets.push(d) },
        },
      ],
    );
  }
}

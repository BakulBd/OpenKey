import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import { REPORT_BYTES, REPORT_ID } from './protocol.js';

/**
 * A classic RK board (RK61 RGB by default): one 64-byte feature report 0x0A that accepts every
 * write and answers nothing, as the protocol has no read command. Every report is kept.
 */
export class RkClassicSimulator {
  readonly device: MockHidDevice;
  readonly reports: Uint8Array[] = [];

  constructor(
    identity: DeviceIdentity = {
      vendorId: 0x258a,
      productId: 0x004a,
      productName: 'RK61RGB Wired',
    },
  ) {
    this.device = new MockHidDevice(identity, [
      {
        info: {
          collections: [
            {
              usagePage: 0x0001,
              usage: 0x0080,
              inputReports: [],
              outputReports: [],
              featureReports: [{ reportId: REPORT_ID, size: REPORT_BYTES }],
            },
          ],
        },
        behavior: { onFeatureSet: (_id, d) => void this.reports.push(d.slice()) },
      },
    ]);
  }
}

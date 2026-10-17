import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import { CFG_V2 } from './protocol.js';

/** A Wooting's configuration collection (v2): answers each command, keeps the last colour frame. */
export class WootingSimulator {
  readonly device: MockHidDevice;
  readonly commands: number[] = [];
  readonly frames: Uint8Array[] = [];
  constructor(
    identity: DeviceIdentity = { vendorId: 0x31e3, productId: 0x1402, productName: 'Wooting 80HE' },
    outSize = 256,
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
              usagePage: CFG_V2,
              usage: 0x01,
              inputReports: [{ reportId: 0, size: 256 }],
              outputReports: [{ reportId: 0, size: outSize }],
              featureReports: [{ reportId: 0, size: 7 }],
            },
          ],
        },
        behavior: {
          onFeatureSet: (_id, d, ctx) => {
            this.commands.push(d[2]!);
            const r = new Uint8Array(256);
            r.set([0xd0, 0xda, d[2]!]);
            r[10] = 1;
            ctx.emitInput(r);
          },
          onOutput: (_id, d) => void this.frames.push(d.slice()),
        },
      },
    ]);
  }
}

import { MockHidDevice } from '@openkey/hid';
import { EXAMPLE_PRODUCT_ID, EXAMPLE_SLOTS, EXAMPLE_VENDOR_ID, ExampleCmd } from './protocol.js';

/**
 * Firmware model for the example adapter. A real simulator models the documented firmware only;
 * it is test infrastructure, never evidence about hardware.
 */
export class ExampleSimulator {
  readonly keys = Array.from({ length: EXAMPLE_SLOTS }, () => [0, 0] as [number, number]);
  readonly device: MockHidDevice;

  constructor(identity = { vendorId: EXAMPLE_VENDOR_ID, productId: EXAMPLE_PRODUCT_ID, productName: 'Example pad' }) {
    const report = [{ reportId: 0, size: 32 }];
    this.device = new MockHidDevice(identity, [
      {
        info: { collections: [{ usagePage: 0xffee, usage: 0x01, inputReports: report, outputReports: report, featureReports: [] }] },
        behavior: {
          onOutput: (_id, d, ctx) => {
            const r = new Uint8Array(32);
            r[0] = d[0]!;
            if (d[0] === ExampleCmd.HELLO) r.set([0x4f, 0x4b, 1], 1);
            else if (d[0] === ExampleCmd.GET_KEY) r.set([d[1]!, ...(this.keys[d[1]!] ?? [0, 0])], 1);
            else if (d[0] === ExampleCmd.SET_KEY) {
              const ok = d[1]! < EXAMPLE_SLOTS;
              if (ok) this.keys[d[1]!] = [d[2]!, d[3]!];
              r.set([d[1]!, ok ? 0 : 1], 1);
            } else return; // unknown command: silence, like a stalled firmware
            ctx.emitInput(r);
          },
        },
      },
    ]);
  }
}

import { MockHidDevice } from '@openkey/hid';
import type { MockContext } from '@openkey/hid';
import { REPORT_BYTES, REPORT_ID } from './protocol.js';
import { M87Cmd } from './rk-m87.js';

/**
 * The RK M87 receiver as ElXreno/rk-m87-sync describes it: `07` answers with the link state,
 * `0B` is acknowledged while the keyboard is awake. Every request is kept.
 */
export class RkM87ReceiverSimulator {
  readonly device: MockHidDevice;
  readonly sent: Uint8Array[] = [];
  /** Whether the keyboard behind the receiver is awake. */
  awake = true;

  constructor() {
    this.device = new MockHidDevice(
      { vendorId: 0x258a, productId: 0x0150, productName: 'SINOWEALTH Gaming KB' },
      [
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
            interfaceNumber: 1,
            collections: [
              {
                usagePage: 0xff02,
                usage: 0x02,
                inputReports: [{ reportId: REPORT_ID, size: REPORT_BYTES }],
                outputReports: [{ reportId: REPORT_ID, size: REPORT_BYTES }],
                featureReports: [],
              },
            ],
          },
          behavior: { onOutput: (_id, d, ctx) => this.on(d, ctx) },
        },
      ],
      '2.4ghz',
    );
  }

  private reply(ctx: MockContext, cmd: number, data: number[]): void {
    const r = new Uint8Array(REPORT_BYTES);
    r.set([cmd, 1, 0, data.length, ...data]);
    r[REPORT_BYTES - 1] =
      (REPORT_ID + r.subarray(0, REPORT_BYTES - 1).reduce((a, b) => a + b, 0)) & 0xff;
    ctx.emitInput(r);
  }

  private on(d: Uint8Array, ctx: MockContext): void {
    this.sent.push(d.slice());
    if (d[0] === M87Cmd.DONGLE_STATUS) this.reply(ctx, M87Cmd.DONGLE_STATUS, [this.awake ? 1 : 0]);
    else if (d[0] === M87Cmd.SET_SCREEN_PARAM && this.awake)
      this.reply(ctx, M87Cmd.SET_SCREEN_PARAM, []);
  }
}

import { MockHidDevice } from '@openkey/hid';
import type { MockBehavior, MockContext } from '@openkey/hid';
import { F75_PAGE } from '../by-tech/simulator.js';
import { Cmd, REPORT_BYTES, REPORT_ID } from './protocol.js';

const F99_PRO = Uint8Array.from([0x03, 0x00, 0x00, 0x00, 0x01, 0x58]);

/** An AULA receiver with a keyboard behind it, as far as the read commands go. Unknown commands get no reply. */
export class AulaReceiverSimulator {
  readonly device: MockHidDevice;
  readonly sent: number[] = [];

  constructor(
    readonly modelCode: Uint8Array = F99_PRO,
    readonly page: Uint8Array = F75_PAGE,
    /** Extra input reports the keyboard emits on the same interface (media keys …) before each reply. */
    readonly noise = true,
  ) {
    const behavior: MockBehavior = { onOutput: (_id, d, ctx) => this.on(d, ctx) };
    this.device = new MockHidDevice(
      {
        vendorId: 0x3554,
        productId: 0xfa09,
        productName: '2.4G Wireless Receiver',
        manufacturer: 'CX',
      },
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
              {
                usagePage: 0x0c,
                usage: 0x01,
                inputReports: [{ reportId: 5, size: 2 }],
                outputReports: [],
                featureReports: [],
              },
            ],
          },
          behavior,
        },
      ],
    );
  }

  private reply(
    ctx: MockContext,
    cmd: number,
    total: number,
    index: number,
    data: Uint8Array,
  ): void {
    const r = new Uint8Array(REPORT_BYTES);
    r.set([cmd, total, index, data.length]);
    r.set(data, 4);
    r[REPORT_BYTES - 1] =
      (REPORT_ID + r.subarray(0, REPORT_BYTES - 1).reduce((a, b) => a + b, 0)) & 0xff;
    ctx.emitInput(r);
  }

  private on(d: Uint8Array, ctx: MockContext): void {
    this.sent.push(d[0]!);
    if (this.noise) ctx.emitInput(Uint8Array.of(0xe9, 0x00));
    if (d[0] === Cmd.IDENTITY)
      this.reply(ctx, Cmd.IDENTITY, 1, 0, Uint8Array.from([...this.modelCode, 0x01, 0, 0, 0]));
    else if (d[0] === Cmd.VERSION)
      this.reply(ctx, Cmd.VERSION_REPLY, 1, 0, Uint8Array.of(0x05, 87, 0x01, 0x00));
    else if (d[0] === Cmd.LED_PAGE) {
      const total = Math.ceil(this.page.length / 14);
      for (let i = 0; i < total; i++)
        this.reply(ctx, Cmd.LED_PAGE, total, i, this.page.subarray(i * 14, i * 14 + 14));
    }
  }
}

import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import { Cmd, EFFECT_BYTES, HEADER, TABLE_BYTES } from './codec.js';

/**
 * An AULA F87S 8K (or another listed board) as the public notes describe it: device info, the
 * 16-byte lighting block and the 128-slot colour table, each read and written in packets that are
 * acknowledged one by one. `lighting: false` models a board that ignores the lighting read.
 */
export class HubSimulator {
  readonly device: MockHidDevice;
  readonly writes: { cmd: number; data: Uint8Array }[] = [];
  effect = Uint8Array.from([15, 255, 255, 255, 255, 0, 0, 0, 1, 5, 3, 0, 0, 0, 0xaa, 0x55]);
  readonly table = new Uint8Array(TABLE_BYTES);
  body: [number, number];
  private pending = new Map<number, Uint8Array>();

  constructor(
    identity: DeviceIdentity = { vendorId: 0x38a6, productId: 0x2908, productName: 'AULA F87S 8K' },
    opts: { reportSize?: number; lighting?: boolean; body?: [number, number] } = {},
  ) {
    const size = opts.reportSize ?? 64;
    const lighting = opts.lighting ?? true;
    this.body = opts.body ?? [0x38a6, 0x2908];
    for (let s = 0; s < 128; s++) this.table.set([s, 0x10, 0x20, s === 127 ? 0x7f : 0x30], s * 4);
    const page = identity.productId === 0xfef9 ? 0xff60 : 0xff68;
    this.device = new MockHidDevice(
      identity,
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
                usagePage: page,
                usage: 0x61,
                inputReports: [{ reportId: 0, size }],
                outputReports: [{ reportId: 0, size }],
                featureReports: [],
              },
            ],
          },
          behavior: {
            onOutput: (_id, d, ctx) => {
              if (d[0] !== 0xaa) return;
              const cmd = d[1]!;
              const len = d[2]!;
              const addr = d[3]! | (d[4]! << 8);
              const last = d[6] === 1;
              const reply = new Uint8Array(size);
              reply.set([0x55, cmd, len, d[3]!, d[4]!]);
              const source = this.readSource(cmd, lighting);
              if (source) reply.set(source.subarray(addr, addr + len), HEADER);
              else if (cmd === Cmd.SET_LED_EFFECT || cmd === Cmd.SET_CUSTOM_LED) {
                const buf =
                  this.pending.get(cmd) ??
                  new Uint8Array(cmd === Cmd.SET_LED_EFFECT ? EFFECT_BYTES : TABLE_BYTES);
                buf.set(d.subarray(HEADER, HEADER + len), addr);
                this.pending.set(cmd, buf);
                if (last) {
                  this.pending.delete(cmd);
                  this.writes.push({ cmd, data: buf });
                  (cmd === Cmd.SET_LED_EFFECT ? this.effect : this.table).set(buf);
                }
              } else return;
              ctx.emitInput(reply);
            },
          },
        },
      ],
      identity.productId === 0xfef9 ? '2.4ghz' : 'usb',
    );
  }

  private readSource(cmd: number, lighting: boolean): Uint8Array | null {
    if (cmd === Cmd.DEVICE_INFO) {
      const d = new Uint8Array(56);
      d.set([this.body[0] & 0xff, this.body[0] >> 8, this.body[1] & 0xff, this.body[1] >> 8], 4);
      d.set([0x23, 0x01], 8);
      d[17] = 100;
      d[31] = 1;
      return d;
    }
    if (!lighting) return null;
    if (cmd === Cmd.GET_LED_EFFECT) return this.effect;
    if (cmd === Cmd.GET_CUSTOM_LED) return this.table;
    return null;
  }
}

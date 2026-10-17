import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import { Cmd, REPORT_LEN, Status } from './codec.js';

/**
 * The AJ179 as its public protocol reference describes it: replies echo the command, read replies
 * use the write payload layout, a mode change only switches the mode until it is written again, and
 * the receiver pushes `c0` status frames. Factory state from the source's read-back.
 */
export class Aj179Simulator {
  readonly device: MockHidDevice;
  readonly writes: Uint8Array[] = [];
  asleep = false;
  rate = 0x01;
  dpi = [400, 800, 1200, 1600, 2400, 3200].map((d) => d / 50 - 1);
  dpiIndex = 1;
  dpiCount = 6;
  lighting = { mode: 3, bs: 0x42, rgb: [0xff, 0x00, 0x00] };
  /** Levels each mode remembers (a mode switch restores them). */
  private saved = new Map<number, { bs: number; rgb: number[] }>([
    [2, { bs: 0x20, rgb: [0, 0, 0] }],
  ]);
  sensor = [2, 0, 0];
  power = [30, 1, 0, 8];
  battery = 82;

  constructor(identity?: DeviceIdentity) {
    this.device = new MockHidDevice(
      identity ?? { vendorId: 0x249a, productId: 0x5c2f, productName: '2.4G Wireless Receiver' },
      [
        {
          info: {
            collections: [
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
                usagePage: 0xff02,
                usage: 0x01,
                inputReports: [{ reportId: 0, size: REPORT_LEN }],
                outputReports: [{ reportId: 0, size: REPORT_LEN }],
                featureReports: [],
              },
            ],
          },
          behavior: {
            onOutput: (_id, d, ctx) => {
              // A status frame first, as the receiver sends when the mouse wakes.
              ctx.emitInput(Uint8Array.from([0xc0, 1, this.battery, ...new Array(29).fill(0)]));
              ctx.emitInput(this.answer(d));
            },
          },
        },
      ],
      identity?.vendorId === 0x248a ? 'usb' : '2.4ghz',
    );
  }

  private reply(cmd: number, payload: number[], status: number = Status.OK): Uint8Array {
    const r = new Uint8Array(REPORT_LEN);
    r[0] = cmd;
    r[1] = status;
    r[2] = 1;
    r[3] = payload.length;
    r.set(payload, 4);
    r[31] = r.subarray(4, 31).reduce((a, b) => a + b, 0) & 0xff;
    return r;
  }

  private dpiPayload(): number[] {
    const p = [(this.dpiIndex << 4) | this.dpiCount];
    for (const raw of this.dpi) p.push(raw & 0xff, raw >> 8, raw & 0xff, raw >> 8);
    return p;
  }

  private answer(d: Uint8Array): Uint8Array {
    const cmd = d[0]!;
    if (cmd === Cmd.INFO)
      return this.reply(cmd, [
        0x4d,
        0x31,
        0x37,
        0x39,
        0,
        0,
        0x95,
        0x10,
        0,
        this.battery,
        this.asleep ? 0 : 1,
      ]);
    if (this.asleep) return this.reply(cmd, [], Status.ASLEEP);
    const p = [...d.subarray(4, 4 + d[3]!)];
    switch (cmd) {
      case Cmd.GET_RATE:
        return this.reply(cmd, [this.rate]);
      case Cmd.GET_DPI:
        return this.reply(cmd, this.dpiPayload());
      case Cmd.GET_LIGHTING:
        return this.reply(cmd, [this.lighting.mode, this.lighting.bs, ...this.lighting.rgb]);
      case Cmd.GET_SENSOR:
        return this.reply(cmd, [...this.sensor, 0, 0]);
      case Cmd.GET_POWER:
        return this.reply(cmd, this.power);
    }
    this.writes.push(d.slice());
    switch (cmd) {
      case Cmd.SET_RATE:
        this.rate = p[0]!;
        break;
      case Cmd.SET_DPI:
        this.dpiIndex = p[0]! >> 4;
        this.dpiCount = p[0]! & 0x0f;
        this.dpi = this.dpi.map((_, i) => p[1 + 4 * i]! | (p[2 + 4 * i]! << 8));
        break;
      case Cmd.SET_LIGHTING: {
        const mode = p[0]!;
        if (mode !== this.lighting.mode) {
          this.saved.set(this.lighting.mode, { bs: this.lighting.bs, rgb: this.lighting.rgb });
          const back = this.saved.get(mode) ?? { bs: 0x40, rgb: [0xff, 0xff, 0xff] };
          this.lighting = { mode, bs: back.bs, rgb: back.rgb };
        } else {
          this.lighting = { mode, bs: p[1]!, rgb: mode === 3 ? p.slice(2, 5) : this.lighting.rgb };
        }
        break;
      }
      case Cmd.SET_SENSOR:
        this.sensor = p.slice(0, 3);
        break;
      case Cmd.SET_POWER:
        this.power = p.slice(0, 4);
        break;
    }
    return this.reply(cmd, p);
  }
}

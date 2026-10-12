import type { DeviceIdentity } from '@openkey/core';
import { MockHidDevice } from '@openkey/hid';
import type { MockBehavior, MockContext } from '@openkey/hid';
import {
  Channel,
  Cmd,
  KeyboardValue,
  LightValue,
  RAW_USAGE,
  RAW_USAGE_PAGE,
  REPORT_SIZE,
  UNHANDLED,
} from './constants.js';
import type { LightingChannel } from './constants.js';

export interface ViaSimulatorOptions {
  identity?: DeviceIdentity;
  protocolVersion?: number;
  rows?: number;
  cols?: number;
  layers?: number;
  macroCount?: number;
  macroSize?: number;
  /** Lighting channel the firmware has, or null for none. */
  channel?: LightingChannel | null;
}

/**
 * A QMK firmware with VIA, as far as the protocol goes: dynamic keymap, macro buffer, one lighting
 * channel. Layer 0 starts as a 5 × 15 ANSI-like map (letters and digits), upper layers transparent.
 */
export class ViaSimulator {
  readonly device: MockHidDevice;
  readonly rows: number;
  readonly cols: number;
  readonly layers: number;
  readonly keymap: Uint8Array;
  readonly macros: Uint8Array;
  readonly macroCount: number;
  readonly lighting = new Map<number, number[]>([
    [LightValue.BRIGHTNESS, [180]],
    [LightValue.EFFECT, [1]],
    [LightValue.SPEED, [128]],
    [LightValue.COLOR, [170, 255]],
  ]);
  saved = 0;
  /** Every command byte received, in order. */
  readonly commands: number[] = [];

  constructor(private readonly opts: ViaSimulatorOptions = {}) {
    this.rows = opts.rows ?? 5;
    this.cols = opts.cols ?? 15;
    this.layers = opts.layers ?? 4;
    this.macroCount = opts.macroCount ?? 16;
    this.keymap = new Uint8Array(this.layers * this.rows * this.cols * 2);
    this.macros = new Uint8Array(opts.macroSize ?? 512);
    const base = [
      0x29, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2d, 0x2e, 0x2a, 0x4c,
    ];
    for (let c = 0; c < this.cols; c++) this.setCode(0, 0, c, base[c] ?? 0x04);
    for (let r = 1; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) this.setCode(0, r, c, 0x04 + ((r * this.cols + c) % 26));
    for (let l = 1; l < this.layers; l++)
      for (let i = 0; i < this.rows * this.cols; i++)
        this.setCode(l, Math.floor(i / this.cols), i % this.cols, 0x0001);
    const behavior: MockBehavior = { onOutput: (_id, d, ctx) => this.onCommand(d, ctx) };
    this.device = new MockHidDevice(
      opts.identity ?? { vendorId: 0xfeed, productId: 0x6060, productName: 'OpenKey VIA demo 60%' },
      [
        {
          info: {
            collections: [
              {
                usagePage: RAW_USAGE_PAGE,
                usage: RAW_USAGE,
                inputReports: [{ reportId: 0, size: REPORT_SIZE }],
                outputReports: [{ reportId: 0, size: REPORT_SIZE }],
                featureReports: [],
              },
            ],
          },
          behavior,
        },
      ],
    );
  }

  code(layer: number, row: number, col: number): number {
    const i = ((layer * this.rows + row) * this.cols + col) * 2;
    return (this.keymap[i]! << 8) | this.keymap[i + 1]!;
  }

  private setCode(layer: number, row: number, col: number, code: number): void {
    const i = ((layer * this.rows + row) * this.cols + col) * 2;
    this.keymap[i] = code >> 8;
    this.keymap[i + 1] = code & 0xff;
  }

  private onCommand(d: Uint8Array, ctx: MockContext): void {
    const r = new Uint8Array(REPORT_SIZE);
    r.set(d.subarray(0, REPORT_SIZE));
    const cmd = d[0]!;
    this.commands.push(cmd);
    const channel = this.opts.channel === undefined ? Channel.RGB_MATRIX : this.opts.channel;
    switch (cmd) {
      case Cmd.GET_PROTOCOL_VERSION: {
        const v = this.opts.protocolVersion ?? 0x000c;
        r[1] = v >> 8;
        r[2] = v & 0xff;
        break;
      }
      case Cmd.GET_KEYBOARD_VALUE:
        if (d[1] === KeyboardValue.FIRMWARE_VERSION) r.set([0, 0, 0, 1], 2);
        else r[0] = UNHANDLED;
        break;
      case Cmd.KEYMAP_GET_LAYER_COUNT:
        r[1] = this.layers;
        break;
      case Cmd.KEYMAP_GET_KEYCODE: {
        const c = this.code(d[1]!, d[2]!, d[3]!);
        r[4] = c >> 8;
        r[5] = c & 0xff;
        break;
      }
      case Cmd.KEYMAP_SET_KEYCODE:
        this.setCode(d[1]!, d[2]!, d[3]!, (d[4]! << 8) | d[5]!);
        break;
      case Cmd.KEYMAP_GET_BUFFER:
      case Cmd.MACRO_GET_BUFFER: {
        const src = cmd === Cmd.KEYMAP_GET_BUFFER ? this.keymap : this.macros;
        const off = (d[1]! << 8) | d[2]!;
        r.set(src.subarray(off, off + d[3]!), 4);
        break;
      }
      case Cmd.KEYMAP_SET_BUFFER:
      case Cmd.MACRO_SET_BUFFER: {
        const dst = cmd === Cmd.KEYMAP_SET_BUFFER ? this.keymap : this.macros;
        const off = (d[1]! << 8) | d[2]!;
        dst.set(d.subarray(4, 4 + d[3]!), off);
        break;
      }
      case Cmd.MACRO_GET_COUNT:
        r[1] = this.macroCount;
        break;
      case Cmd.MACRO_GET_BUFFER_SIZE:
        r[1] = this.macros.length >> 8;
        r[2] = this.macros.length & 0xff;
        break;
      case Cmd.CUSTOM_GET_VALUE:
      case Cmd.CUSTOM_SET_VALUE:
      case Cmd.CUSTOM_SAVE:
        if (channel === null || d[1] !== channel) {
          r[0] = UNHANDLED;
          break;
        }
        if (cmd === Cmd.CUSTOM_SAVE) this.saved++;
        else if (cmd === Cmd.CUSTOM_GET_VALUE) r.set(this.lighting.get(d[2]!) ?? [0, 0], 3);
        else this.lighting.set(d[2]!, Array.from(d.subarray(3, 5)));
        break;
      default:
        r[0] = UNHANDLED;
    }
    ctx.emitInput(r);
  }
}

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
  /** Rotary encoders with a VIA encoder map (QMK ENCODER_MAP_ENABLE). */
  encoders?: number;
  /**
   * Keyboard-specific custom values the firmware answers (VIA custom menus): key "channel,id",
   * value bytes. Channels listed here are handled besides the lighting channel.
   */
  custom?: Record<string, number[]>;
  /** Stored layout options (VIA keyboard value 0x02). */
  layoutOptions?: number;
  /** Vial firmware: the XZ-compressed definition it serves, and its protocol version. */
  vial?: {
    definition: Uint8Array;
    protocol?: number;
    uid?: number[];
    /** QMK settings: id → [width, value]. */
    settings?: Record<number, [number, number]>;
    /** Tap dance, combo and key override slots (10 bytes each). */
    tapDance?: number;
    combos?: number;
    keyOverrides?: number;
  };
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
  /** Vial dynamic entries: key `${kind},${index}` → 10 bytes. Every Vial sub-command received. */
  readonly vialEntries = new Map<string, number[]>();
  readonly vialCommands: number[][] = [];
  /** Encoder map: key `${layer},${id},${clockwise}`. */
  readonly encoderMap = new Map<string, number>();
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

  /** Vial (quantum/vial.c): replies overwrite the report from byte 0; plain VIA says unhandled. */
  private onVial(d: Uint8Array, r: Uint8Array): Uint8Array {
    const vial = this.opts.vial;
    if (!vial) {
      r[0] = UNHANDLED;
      return r;
    }
    const def = vial.definition;
    this.vialCommands.push(Array.from(d.subarray(1, 3)));
    const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
    switch (d[1]) {
      case 0x00:
        r.set([...le32(vial.protocol ?? 6), ...(vial.uid ?? [1, 2, 3, 4, 5, 6, 7, 8])], 0);
        break;
      case 0x01:
        r.set(le32(def.length), 0);
        break;
      case 0x02: {
        const start = (d[2]! | (d[3]! << 8)) * REPORT_SIZE;
        if (start < def.length) r.set(def.subarray(start, start + REPORT_SIZE), 0);
        break;
      }
      case 0x09: {
        const after = d[2]! | (d[3]! << 8);
        r.fill(0xff);
        const ids = Object.keys(vial.settings ?? {})
          .map(Number)
          .filter((id) => id > after)
          .sort((a, b) => a - b)
          .slice(0, 16);
        ids.forEach((id, i) => r.set([id & 0xff, id >> 8], i * 2));
        break;
      }
      case 0x0a:
      case 0x0b: {
        const id = d[2]! | (d[3]! << 8);
        const st = vial.settings?.[id];
        if (!st) {
          r[0] = 0xff;
          break;
        }
        const [width] = st;
        if (d[1] === 0x0b) {
          let v = 0;
          for (let i = width - 1; i >= 0; i--) v = v * 256 + d[4 + i]!;
          st[1] = v;
          r[0] = 0;
        } else {
          r[0] = 0;
          for (let i = 0; i < width; i++) r[1 + i] = (st[1] >>> (8 * i)) & 0xff;
        }
        break;
      }
      case 0x0d: {
        const op = d[2]!;
        const kinds = ['td', 'combo', 'ko'];
        const limits = [vial.tapDance ?? 0, vial.combos ?? 0, vial.keyOverrides ?? 0];
        if (op === 0x00) {
          r.fill(0);
          r.set(limits, 0);
          r[REPORT_SIZE - 1] = 1; // Caps Word
          break;
        }
        const kind = (op - 1) >> 1;
        const index = d[3]!;
        if (kind > 2 || index >= limits[kind]!) {
          r[0] = 1;
          break;
        }
        const key = `${kinds[kind]},${index}`;
        if (op % 2 === 0) {
          this.vialEntries.set(key, Array.from(d.subarray(4, 14)));
          r[0] = 0;
        } else {
          r[0] = 0;
          r.set(this.vialEntries.get(key) ?? new Array(10).fill(0), 1);
        }
        break;
      }
      default:
        r.fill(0);
    }
    return r;
  }

  private onCommand(d: Uint8Array, ctx: MockContext): void {
    const r = new Uint8Array(REPORT_SIZE);
    r.set(d.subarray(0, REPORT_SIZE));
    const cmd = d[0]!;
    this.commands.push(cmd);
    if (cmd === 0xfe) {
      ctx.emitInput(this.onVial(d, r));
      return;
    }
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
        else if (d[1] === KeyboardValue.LAYOUT_OPTIONS && this.opts.layoutOptions !== undefined) {
          const v = this.opts.layoutOptions;
          r.set([(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff], 2);
        } else r[0] = UNHANDLED;
        break;
      case Cmd.KEYMAP_GET_ENCODER:
      case Cmd.KEYMAP_SET_ENCODER: {
        if (!this.opts.encoders || d[2]! >= this.opts.encoders || d[1]! >= this.layers) {
          r[0] = UNHANDLED;
          break;
        }
        const key = `${d[1]},${d[2]},${d[3] ? 1 : 0}`;
        if (cmd === Cmd.KEYMAP_SET_ENCODER) this.encoderMap.set(key, (d[4]! << 8) | d[5]!);
        else {
          // Default map: volume up clockwise, volume down counter-clockwise (KC_VOLU / KC_VOLD).
          const c = this.encoderMap.get(key) ?? (d[3] ? 0x00a9 : 0x00aa);
          r[4] = c >> 8;
          r[5] = c & 0xff;
        }
        break;
      }
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
      case Cmd.CUSTOM_SAVE: {
        const custom = this.opts.custom;
        const k = `${d[1]},${d[2]}`;
        if (
          custom &&
          (cmd === Cmd.CUSTOM_SAVE
            ? Object.keys(custom).some((x) => x.startsWith(`${d[1]},`))
            : k in custom)
        ) {
          if (cmd === Cmd.CUSTOM_SAVE) this.saved++;
          else if (cmd === Cmd.CUSTOM_GET_VALUE) r.set(custom[k]!, 3);
          else custom[k] = Array.from(d.subarray(3, 3 + custom[k]!.length));
          break;
        }
        if (channel === null || d[1] !== channel) {
          r[0] = UNHANDLED;
          break;
        }
        if (cmd === Cmd.CUSTOM_SAVE) this.saved++;
        else if (cmd === Cmd.CUSTOM_GET_VALUE) r.set(this.lighting.get(d[2]!) ?? [0, 0], 3);
        else this.lighting.set(d[2]!, Array.from(d.subarray(3, 5)));
        break;
      }
      default:
        r[0] = UNHANDLED;
    }
    ctx.emitInput(r);
  }
}

/**
 * The demo Vial board's own definition: an OpenKey-authored 60% ANSI layout (5 × 15 matrix) with a
 * knob and a "Keyboard" custom menu,
 * XZ-compressed the way Vial builds compress vial.json (Python lzma.compress).
 */
export const VIAL_DEMO_DEFINITION: Uint8Array = Uint8Array.from(
  atob(
    '/Td6WFoAAATm1rRGAgAhARYAAAB0L+Wj4ASyAeNdAD2IicZUNsMXT+Tj06QxL5FGOlFOoOlznOBdGFh3g/BDPBt8LorOsIiBFNr1a0ctLrWW9Igm82LkHqEIu93k8woafpGv6LUcxO3fTGEZqHaJFjIBWSBYw02a1YxgzMJMVdzx1N13z8ro3aDG05fIroy/lljO52tYpsqoprAzamaccoijtV1CXgJddECfetOpZsndkLCHQplfpmKhSfGFJwpMMNQm5ZIf84hpUW6V3M696xKxjTgxXKJy4rJc6pJ2H/apgFTpnor8SmcB0xi9ueK6qNNbOB/dr2Wz+gqAd3+O8sXe/OpVAjchcImJ3zzPk3zD2PEv5Df5PzbhzbSFHcWudv9IOk04cOXoADOeYcUPSC6Lv+EoyYn7GxnNmJtiMmhmItWuPIoG+oUnvrFvWCvP/c0M/1O0LBfSO9xiQvphcUwHUDwULsLbnikFUqIiOQ0hJzxdJcX7eSWPzYofOSfEuXwLNE/+Wdzrp6vRWBCp0bNfXwZAo9JyYfbDx+EgJ7UWeK0BHHNU8g8YrQo2N6aTCH34NG+EAcxisJjXXdElLYr6DtuNI62c7HmqirRsa5zVcXIoOGeB9xyNH3QenPUr6Q02OdMt7kFiVvtgP9CQ8j2XQM5Oghji9o/WuEu0svg1wAAAy0mqO+VOY4UAAf8DswkAADrfJ2CxxGf7AgAAAAAEWVo=',
  ),
  (c) => c.charCodeAt(0),
);

/** The custom values the demo Vial board answers (knob mode, tapping term, scroll speed, Caps as Ctrl). */
export const VIAL_DEMO_CUSTOM = (): Record<string, number[]> => ({
  '0,1': [0],
  '0,2': [0x00, 0xc8],
  '0,3': [5],
  '0,4': [0],
});

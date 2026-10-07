import { MockHidDevice } from '@openak820/hid';
import type { DeviceIdentity } from '@openak820/core';
import {
  Cmd,
  CUSTOM_LED_BYTES,
  DEVICE_INFO_BYTES,
  GAME_MODE_BYTES,
  HEADER_BYTES,
  IN_MAGIC,
  KEY_TABLE_BYTES,
  LED_EFFECT_BYTES,
  OUT_MAGIC,
} from './constants.js';

/**
 * Behavioural model of an online-protocol AK820 Pro (FF68 64-byte command pipe, FF67 4104-byte
 * TFT pipe) for tests. Memory regions are addressed like the firmware (addr = byte offset).
 */
export class SonixAa55Simulator {
  readonly memory = new Map<number, Uint8Array>();
  readonly device: MockHidDevice;
  tftChunks: Uint8Array[] = [];

  constructor(
    identity: DeviceIdentity = { vendorId: 0x0c45, productId: 0x8009, productName: 'AK820' },
    firmware = { major: 1, minor: 7 },
  ) {
    const info = new Uint8Array(DEVICE_INFO_BYTES);
    info[2] = 0x00;
    info[3] = 0x0c; // macro space 3072
    info[4] = identity.vendorId & 0xff;
    info[5] = identity.vendorId >> 8;
    info[6] = identity.productId & 0xff;
    info[7] = identity.productId >> 8;
    info[8] = ((Math.floor(firmware.minor / 10) & 15) << 4) | (firmware.minor % 10);
    info[9] = firmware.major;
    info[17] = 87; // battery
    info[22] = 255; // tft max frames
    this.memory.set(Cmd.GET_DEVICE_INFO, info);
    this.memory.set(Cmd.GET_GAME_MODE, new Uint8Array(GAME_MODE_BYTES));
    this.memory.set(Cmd.GET_KEY, new Uint8Array(KEY_TABLE_BYTES));
    this.memory.set(Cmd.GET_FN_KEY, new Uint8Array(KEY_TABLE_BYTES));
    this.memory.set(Cmd.GET_LED_EFFECT, new Uint8Array(LED_EFFECT_BYTES));
    this.memory.set(Cmd.GET_CUSTOM_LED_DATA, new Uint8Array(CUSTOM_LED_BYTES));
    this.memory.set(Cmd.GET_MACRO, new Uint8Array(4096));
    const SET_TO_GET: Record<number, number> = {
      [Cmd.SET_GAME_MODE]: Cmd.GET_GAME_MODE,
      [Cmd.SET_KEY]: Cmd.GET_KEY,
      [Cmd.SET_FN_KEY]: Cmd.GET_FN_KEY,
      [Cmd.SET_LED_EFFECT]: Cmd.GET_LED_EFFECT,
      [Cmd.SET_CUSTOM_LED_DATA]: Cmd.GET_CUSTOM_LED_DATA,
      [Cmd.SET_MACRO]: Cmd.GET_MACRO,
    };
    const respond = (frame: Uint8Array, data?: Uint8Array, cmd = frame[1]!) => {
      const r = new Uint8Array(64);
      r[0] = IN_MAGIC;
      r[1] = cmd;
      r[2] = frame[2]!;
      r[3] = frame[3]!;
      r[4] = frame[4]!;
      if (data) r.set(data.subarray(0, 64 - HEADER_BYTES), HEADER_BYTES);
      return r;
    };
    this.device = new MockHidDevice(identity, [
      {
        info: {
          collections: [
            {
              usagePage: 0xff68,
              usage: 0x61,
              inputReports: [{ reportId: 0, size: 64 }],
              outputReports: [{ reportId: 0, size: 64 }],
              featureReports: [],
            },
          ],
        },
        behavior: {
          onOutput: (_id, f, ctx) => {
            if (f[0] !== OUT_MAGIC) return;
            const cmd = f[1]!,
              len = f[2]!,
              addr = f[3]! | (f[4]! << 8);
            if (SET_TO_GET[cmd] !== undefined) {
              const mem = this.memory.get(SET_TO_GET[cmd]!)!;
              mem.set(f.subarray(HEADER_BYTES, HEADER_BYTES + len), addr);
              ctx.emitInput(respond(f));
              return;
            }
            const mem = this.memory.get(cmd);
            if (mem) ctx.emitInput(respond(f, mem.subarray(addr, addr + len)));
            else if (cmd === Cmd.SET_TEMPORARY_COMMAND_DATA) ctx.emitInput(respond(f));
          },
        },
      },
      {
        info: {
          collections: [
            {
              usagePage: 0xff67,
              usage: 0x01,
              inputReports: [{ reportId: 0, size: 64 }],
              outputReports: [{ reportId: 0, size: 4104 }],
              featureReports: [],
            },
          ],
        },
        behavior: {
          onOutput: (_id, f, ctx) => {
            this.tftChunks.push(f.slice());
            ctx.emitInput(respond(f, undefined, Cmd.SET_LED_USER_ANIMATION));
          },
        },
      },
    ]);
  }
}

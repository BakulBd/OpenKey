import { MalformedResponseError, toHex } from '@openkey/core';
import {
  ACK_OFFSET,
  ACK_OK,
  CMD_NAMES,
  COMMAND_PREFIX,
  PACKET_SIZE,
  TRAILER,
} from './constants.js';

export interface CommandArgs {
  /** payload[2]: sub-command / slot. */
  sub?: number;
  /** payload[8]: argument (packet count, enable flag, …). */
  arg8?: number;
  /** payload[9]: high byte of a 16-bit argument. */
  arg9?: number;
}

/** `04 <cmd> <sub> 00 00 00 00 00 <arg8> <arg9> 00…` */
export function commandPacket(cmd: number, args: CommandArgs = {}): Uint8Array {
  const p = new Uint8Array(PACKET_SIZE);
  p[0] = COMMAND_PREFIX;
  p[1] = cmd & 0xff;
  p[2] = (args.sub ?? 0) & 0xff;
  p[8] = (args.arg8 ?? 0) & 0xff;
  p[9] = (args.arg9 ?? 0) & 0xff;
  return p;
}

/** A command with a 16-bit little-endian argument in payload[8..9] (e.g. chunk count). */
export function commandPacketU16(cmd: number, sub: number, value: number): Uint8Array {
  return commandPacket(cmd, { sub, arg8: value & 0xff, arg9: (value >> 8) & 0xff });
}

export interface AckInfo {
  ok: boolean;
  busy: boolean;
  /** True when payload[0..1] echo the command header. */
  echoes: boolean;
  status: number;
}

export function parseAck(resp: Uint8Array, cmd: number): AckInfo {
  if (resp.length < ACK_OFFSET + 1) {
    throw new MalformedResponseError(`Acknowledgement too short (${resp.length} bytes)`, {
      hex: toHex(resp),
    });
  }
  const status = resp[ACK_OFFSET]!;
  return {
    ok: status === ACK_OK,
    busy: status === 0xff,
    echoes: resp[0] === COMMAND_PREFIX && resp[1] === cmd,
    status,
  };
}

/** Writes the AA 55 trailer into the last two bytes of `buf`. */
export function withTrailer(buf: Uint8Array, at = buf.length - 2): Uint8Array {
  buf[at] = TRAILER[0];
  buf[at + 1] = TRAILER[1];
  return buf;
}

export function hasTrailer(buf: Uint8Array, at = buf.length - 2): boolean {
  return buf[at] === TRAILER[0] && buf[at + 1] === TRAILER[1];
}

export function describePacket(p: Uint8Array): string {
  if (p[0] === COMMAND_PREFIX && p[1] !== undefined && CMD_NAMES[p[1]]) {
    return `${CMD_NAMES[p[1]]} (04 ${p[1].toString(16).padStart(2, '0')}) sub=${p[2]} arg8=${p[8]} arg9=${p[9]}`;
  }
  return 'data';
}

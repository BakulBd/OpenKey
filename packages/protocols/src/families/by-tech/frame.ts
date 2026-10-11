import { ProtocolError } from '@openkey/core';
import { HEADER_BYTES, PAGE_BYTES, REPORT_BYTES } from './constants.js';

/** Number of 512-byte packages a transfer of `len` bytes is split into. */
export function packageCount(len: number): number {
  return len === 0 ? 0 : Math.ceil(len / PAGE_BYTES);
}

/**
 * One command report (without the report ID). `length` is the payload length field; for a read
 * request it announces the size of the reply instead and the payload is empty.
 */
export function frame(
  command: number,
  parameter: number,
  packages: number,
  index: number,
  payload: Uint8Array = new Uint8Array(0),
  length = payload.length,
): Uint8Array {
  if (payload.length > PAGE_BYTES) throw new ProtocolError(`payload of ${payload.length} bytes does not fit one package`);
  const buf = new Uint8Array(REPORT_BYTES);
  buf[0] = command;
  buf[1] = parameter;
  buf[2] = 0;
  buf[3] = packages;
  buf[4] = index;
  buf[5] = length & 0xff;
  buf[6] = (length >> 8) & 0xff;
  buf.set(payload, HEADER_BYTES);
  return buf;
}

/** Splits `data` into command reports, numbered from 0. */
export function writeFrames(command: number, parameter: number, data: Uint8Array): Uint8Array[] {
  const n = packageCount(data.length);
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) out.push(frame(command, parameter, n, i, data.subarray(i * PAGE_BYTES, (i + 1) * PAGE_BYTES)));
  return out;
}

/** Validates a reply: it must echo the command. Returns `len` data bytes. */
export function replyData(reply: Uint8Array, command: number, len: number): Uint8Array {
  if (reply.length < HEADER_BYTES + len)
    throw new ProtocolError(`reply of ${reply.length} bytes is shorter than ${HEADER_BYTES + len}`);
  if (reply[0] !== command)
    throw new ProtocolError(
      `device answered command 0x${(reply[0] ?? 0).toString(16).padStart(2, '0')}, expected 0x${command.toString(16).padStart(2, '0')}`,
    );
  return reply.slice(HEADER_BYTES, HEADER_BYTES + len);
}

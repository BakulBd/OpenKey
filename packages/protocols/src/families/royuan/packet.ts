import { ProtocolError } from '@openkey/core';
import { FORBIDDEN, REPORT_BYTES } from './constants.js';

const ck = (bytes: Uint8Array, upto: number): number => 0xff - (bytes.subarray(0, upto + 1).reduce((a, b) => a + b, 0) & 0xff);

/** A command report: payload from byte 0, checksum "Bit7" (byte 7) or "Bit8" (byte 8). */
export function packet(bytes: readonly number[], checksum: 'bit7' | 'bit8' = 'bit7'): Uint8Array {
  if ((FORBIDDEN as readonly number[]).includes(bytes[0]!)) throw new ProtocolError(`ROYUAN opcode 0x${bytes[0]!.toString(16)} resets, erases or reboots the keyboard; OpenKey never sends it.`);
  const p = new Uint8Array(REPORT_BYTES);
  p.set(bytes.slice(0, checksum === 'bit7' ? 7 : 8));
  if (checksum === 'bit7') p[7] = ck(p, 6);
  else p[8] = ck(p, 7);
  return p;
}

/**
 * A reply proves something only when it echoes the opcode *and* is not just our own request (some
 * firmware, and unrelated devices, return the last report they were sent).
 */
export function isAnswer(reply: Uint8Array, request: Uint8Array): boolean {
  return reply[0] === request[0] && reply.some((b, i) => b !== request[i]);
}

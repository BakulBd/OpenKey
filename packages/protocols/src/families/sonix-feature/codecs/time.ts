import { PACKET_SIZE } from '../constants.js';
import { withTrailer } from '../frame.js';

/** Byte 2 of the time packet (FUN_00423940 writes 0x5A). */
export const TIME_MAGIC = 0x5a;

/**
 * Clock data packet (FUN_00423940, from GetLocalTime):
 *   [0]=00 [1]=slot (screen list selection + 1) [2]=5A [3]=year-2000 [4]=month [5]=day
 *   [6]=hour [7]=minute [8]=second [9]=00 [10]=day of week (0 = Sunday) [62..63]=AA 55
 * Community tools hard-code [10]=0x04; that was simply the weekday (Thursday) of their capture.
 */
export function encodeTimeData(d: Date, slot = 1): Uint8Array {
  const p = new Uint8Array(PACKET_SIZE);
  p[0] = 0x00;
  p[1] = slot & 0xff;
  p[2] = TIME_MAGIC;
  p[3] = (d.getFullYear() % 2000) & 0xff;
  p[4] = d.getMonth() + 1;
  p[5] = d.getDate();
  p[6] = d.getHours();
  p[7] = d.getMinutes();
  p[8] = d.getSeconds();
  p[9] = 0x00;
  p[10] = d.getDay();
  return withTrailer(p);
}

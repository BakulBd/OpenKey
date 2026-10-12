/**
 * The ROYUAN keyboard protocol (YiChip yc500 / yc3121 / yc3123 and ry5088 "gen2" firmware): Akko,
 * MonsGeek, ABKO, AttackShark, the magnetic AJAZZ AK820 with screen and many more, mostly USB VID
 * 3151. Facts from dniminenn/sharkfin docs/PROTOCOL.md (GPL-3.0; facts only, marked [HW] there).
 *
 * 64-byte feature reports, report ID 0, on vendor collection FFFF:0002 (some boards FFFF:0001).
 * Commands carry a checksum `0xFF - (sum & 0xFF)` over bytes 0..6 at byte 7 ("Bit7"), or over
 * bytes 0..7 at byte 8 for the lighting write ("Bit8"). GET replies echo the opcode in byte 0, but
 * an unknown command returns the *previous* reply, so an echo alone proves nothing.
 */
export const ROYUAN_PROTOCOL_ID = 'royuan';
export const USAGE_PAGE = 0xffff;
export const USAGES = [2, 1] as const;
export const REPORT_BYTES = 64;
export const DELAY_MS = 20;

export const Cmd = {
  /** Identify: reply `[0x8F, id:u32 LE, …]`; gen2 firmware version at bytes 7..8. Same in both families. */
  IDENTIFY: 0x8f,
  /** Revision: yc500 answers `(r[2]<<8)|r[1]`; gen2 answers zeros over the cable. */
  REVISION: 0x80,
  /** Lighting read/write; same opcode and payload in both families. */
  GET_LEDPARAM: 0x87,
  SET_LEDPARAM: 0x07,
  /** Active profile; yc500 0x85, gen2 0x84 (both hardware-observed GETs). */
  GET_PROFILE_YC500: 0x85,
  GET_PROFILE_GEN2: 0x84,
  /** Key-map page reads: yc500 base 0x89 / Fn 0x90 `[profile, page]`; gen2 base 0x8A `[profile, FF, page, os]`. */
  GET_KEYMAP_YC500: 0x89,
  GET_FN_YC500: 0x90,
  GET_KEYMAP_GEN2: 0x8a,
  /** yc500 single-slot writes: `[profile, slot]`, value at bytes 8..11. */
  SET_KEY_YC500: 0x13,
  SET_FN_KEY_YC500: 0x15,
} as const;

/** Never sent: factory reset (yc500 / gen2), flash and display erase, USB and display boot entry. */
export const FORBIDDEN = [0x01, 0x02, 0xac, 0x2c, 0x7f, 0x30] as const;

/**
 * Lighting modes that need no host-side data and exist on most boards (1 static … 19 silent snow).
 * Mode 13 (picture) and 20–22, 25 (host-fed) are never offered; some firmware has no mode range
 * guard, so nothing above 19 is ever sent.
 */
export const MODES: readonly [number, string][] = [
  [1, 'Static'],
  [2, 'Breathing'],
  [3, 'Spectrum'],
  [4, 'Wave'],
  [5, 'Ripple'],
  [6, 'Star dots'],
  [7, 'Flow'],
  [8, 'Key shadow'],
  [9, 'Layers'],
  [10, 'Sine'],
  [11, 'Spring'],
  [12, 'Neon'],
  [14, 'Radiant'],
  [15, 'Loop'],
  [16, 'Colour grid'],
  [17, 'Snowfall'],
  [18, 'Meteor'],
  [19, 'Silent snow'],
];
export const MAX_MODE = 19;
/** Flags nibble on most boards: 7 = the packet's colour, 8 = rainbow (swapped on some boards). */
export const FLAG_FIXED = 7;
export const FLAG_RAINBOW = 8;

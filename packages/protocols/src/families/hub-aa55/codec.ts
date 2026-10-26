import { ProtocolError } from '@openkey/core';
import type { KeyAction, MouseAction } from '@openkey/core';
import { decodeCommonSlot, encodeCommonSlot } from '../common/key-slot.js';
import { MACRO_SLOTS } from '../sonix-aa55/constants.js';

/**
 * The web-driver protocol of newer AULA and AJAZZ boards (AULA F87S 8K, AJAZZ AK680 V2 / AK680 MAX
 * RGB): output reports without a report ID on vendor collection FF68:0061 (cable) or FF60:0061
 * (receiver), answered by an input report of the same size.
 *
 *   request  AA cmd len addrLo addrHi 00 last 00 data…
 *   reply    55 cmd len addrLo addrHi …  …    …  data…
 *
 * `addr` is the byte offset of this packet's data in the whole transfer and `len` its length; a
 * transfer longer than one report is split into reports of (report size − 8) bytes, the last one
 * flagged. Reads send zero data of the size they ask for.
 *
 * Facts from Dylan-1107/aula-f87s-hid (MIT; docs/HID-PROTOCOL.md, KEY-MAPPING.md, verified on an
 * F87S by the source), cross-checked with 10ishk/ak680-studio (Apache-2.0; AK680 V2 device info and
 * lighting packets, official profile export) and somenever/not-ajazz-ak680-max-webhid (GPL-3.0; facts
 * only: AK680 MAX framing).
 */
export const HUB_PROTOCOL_ID = 'hub-aa55';
export const HEADER = 8;
export const REQUEST = 0xaa;
export const REPLY = 0x55;

export const Cmd = {
  DEVICE_INFO: 0x10,
  GET_LED_EFFECT: 0x13,
  GET_CUSTOM_LED: 0x14,
  SET_LED_EFFECT: 0x23,
  SET_CUSTOM_LED: 0x24,
  /** Knob-ring and side-bar zones: 24-byte blocks, read (0x1B, 0x1D) and written (0x2B, 0x2D). */
  /**
   * Key maps (AJAZZ's own web driver ajazz.driveall.cn, facts only): 128 keys × 4 bytes, read and
   * written whole; GET_DEFAULT_* return the keyboard's own factory tables.
   */
  GET_KEY: 0x12,
  SET_KEY: 0x22,
  GET_FN_KEY: 0x16,
  SET_FN_KEY: 0x26,
  /**
   * Macro storage (AJAZZ web driver): a 400-byte index of offsets, then the macro blocks; read and
   * written at a byte address, the index without the last-packet flag.
   */
  GET_MACRO: 0x15,
  SET_MACRO: 0x25,
  GET_DEFAULT_KEY_MATRIX: 0x1f,
  GET_DEFAULT_FN_KEY_MATRIX: 0x1c,
  GET_RING_ZONE: 0x1b,
  GET_SIDE_ZONE: 0x1d,
  SET_RING_ZONE: 0x2b,
  SET_SIDE_ZONE: 0x2d,
} as const;

/** A zone block: byte 0 kept, bytes 1–3 the colour, 4–23 kept (Dylan-1107/aula-f87s-hid §5.5). */
export const ZONE_BYTES = 24;
export const ZONE_COLOR_OFFSET = 1;

/** Commands OpenKey never sends: firmware download, factory reset, calibration, screen writes. */
/**
 * Never sent: firmware download, factory reset, screen writes, calibration and simulation, and the
 * OTA / serial-number range (AJAZZ web driver: 0x80–0x86).
 */
export const FORBIDDEN: readonly number[] = [
  0x4f, 0x0f, 0x50, 0x51, 0x64, 0x65, 0x66, 0x67, 0x69, 0x6a, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85,
  0x86,
];
const ALLOWED = new Set<number>(Object.values(Cmd));

export interface TransferOptions {
  /** Byte address of the first packet (macro storage); default 0. */
  offset?: number;
  /** Flag the last packet (default true; the macro index is written without it). */
  lastFlag?: boolean;
}

/** Splits a transfer of `data` into request reports for `reportSize`-byte reports. */
export function requests(
  cmd: number,
  data: Uint8Array,
  reportSize: number,
  opts: TransferOptions = {},
): Uint8Array[] {
  if (FORBIDDEN.includes(cmd) || !ALLOWED.has(cmd))
    throw new ProtocolError(`Command 0x${cmd.toString(16)} is not sent by OpenKey.`);
  const w = reportSize - HEADER;
  if (w < 1) throw new ProtocolError(`Report size ${reportSize} is too small.`);
  const n = Math.max(1, Math.ceil(data.length / w));
  const out: Uint8Array[] = [];
  const offset = opts.offset ?? 0;
  if (offset < 0 || offset + data.length > 0xffff)
    throw new ProtocolError('Transfer address out of range.');
  for (let i = 0; i < n; i++) {
    const chunk = data.subarray(i * w, i * w + w);
    const addr = offset + i * w;
    const last = (opts.lastFlag ?? true) && i === n - 1 ? 1 : 0;
    const r = new Uint8Array(reportSize);
    r.set([REQUEST, cmd, chunk.length, addr & 0xff, addr >> 8, 0, last, 0]);
    r.set(chunk, HEADER);
    out.push(r);
  }
  return out;
}

export interface Reply {
  cmd: number;
  addr: number;
  data: Uint8Array;
}

/** A reply, or null for any other report (status pushes, the other direction's echo …). */
export function parseReply(r: Uint8Array): Reply | null {
  if (r.length < HEADER || r[0] !== REPLY) return null;
  const len = r[2]!;
  if (HEADER + len > r.length) return null;
  return { cmd: r[1]!, addr: r[3]! | (r[4]! << 8), data: r.slice(HEADER, HEADER + len) };
}

export interface HubInfo {
  vendorId: number;
  productId: number;
  firmware: string;
  battery: number | null;
  charging: number;
  /** Bytes of macro storage (bytes 2–3; 0 when the board has none). */
  macroSpace: number;
}

/** Device-info data (cmd 0x10): body VID/PID at 4–7, version at 8–9, battery at 17. */
export function decodeInfo(d: Uint8Array): HubInfo {
  if (d.length < 19) throw new ProtocolError('Device-info reply too short.');
  const v = d[8]!;
  const version = ((v & 0x0f) + ((v & 0xf0) >> 4) * 10 + d[9]! * 100) / 100;
  return {
    vendorId: d[4]! | (d[5]! << 8),
    productId: d[6]! | (d[7]! << 8),
    firmware: version.toFixed(2),
    battery: d[17]! <= 100 ? d[17]! : null,
    charging: d[18]!,
    macroSpace: d[2]! | (d[3]! << 8),
  };
}

/** The 16-byte lighting block (cmd 0x13 read, 0x23 write). */
export const EFFECT_BYTES = 16;
export const CUSTOM_MODE = 20;
export const BRIGHTNESS_MAX = 5;

export interface HubEffect {
  mode: number;
  color: { r: number; g: number; b: number };
  brightness: number;
  speed: number;
  /** The block as read, so writes keep every byte OpenKey does not change. */
  raw: Uint8Array;
}

export function isEffectBlock(d: Uint8Array): boolean {
  return d.length >= EFFECT_BYTES && d[14] === 0xaa && d[15] === 0x55;
}

export function decodeEffect(d: Uint8Array): HubEffect {
  if (!isEffectBlock(d)) throw new ProtocolError('Lighting block without its AA 55 trailer.');
  return {
    mode: d[0]!,
    color: { r: d[1]!, g: d[2]!, b: d[3]! },
    brightness: d[9]!,
    speed: d[10]!,
    raw: d.slice(0, EFFECT_BYTES),
  };
}

/** The block to write: the one read, with mode, colour, brightness and speed replaced. */
export function encodeEffect(base: Uint8Array, e: Omit<HubEffect, 'raw'>): Uint8Array {
  if (!Number.isInteger(e.brightness) || e.brightness < 0 || e.brightness > BRIGHTNESS_MAX)
    throw new ProtocolError(
      `Brightness is 0–${BRIGHTNESS_MAX} (larger values turn the lights off).`,
    );
  if (!Number.isInteger(e.speed) || e.speed < 0 || e.speed > 5)
    throw new ProtocolError('Speed is 0–5.');
  if (!Number.isInteger(e.mode) || e.mode < 1 || e.mode > CUSTOM_MODE)
    throw new ProtocolError(`Effect ${e.mode} is not offered.`);
  const out = base.slice(0, EFFECT_BYTES);
  out[0] = e.mode;
  out.set([e.color.r, e.color.g, e.color.b], 1);
  out[9] = e.brightness;
  out[10] = e.speed;
  out[14] = 0xaa;
  out[15] = 0x55;
  return out;
}

/** The per-key colour table: 128 slots of [slot, R, G, B]. Every slot is written, in order. */
export const TABLE_SLOTS = 128;
export const TABLE_BYTES = TABLE_SLOTS * 4;

export function decodeTable(d: Uint8Array): { r: number; g: number; b: number }[] {
  return Array.from({ length: TABLE_SLOTS }, (_, s) => ({
    r: d[s * 4 + 1] ?? 0,
    g: d[s * 4 + 2] ?? 0,
    b: d[s * 4 + 3] ?? 0,
  }));
}

export function encodeTable(colors: readonly { r: number; g: number; b: number }[]): Uint8Array {
  const out = new Uint8Array(TABLE_BYTES);
  for (let s = 0; s < TABLE_SLOTS; s++) {
    const c = colors[s] ?? { r: 0, g: 0, b: 0 };
    out.set([s, c.r, c.g, c.b], s * 4);
  }
  return out;
}

/**
 * Key entries (AJAZZ web driver): `type p1 p2 p3`. 0 = the key's own factory function, 1 mouse
 * (`1 mask` buttons 1 left, 2 right, 4 middle, 8 back, 16 forward; `3 1` / `3 FF` wheel), 2 keyboard
 * (`0 usage`), 3 media (`lo hi` consumer usage), 6 macro (`index mode repeat`). Others
 * (magnetic-switch functions, keyboard functions) are kept byte for byte.
 */
export const KEY_TABLE_BYTES = 512;
const MOUSE_BUTTONS: Record<string, number> = {
  left: 1,
  right: 2,
  middle: 4,
  back: 8,
  forward: 16,
};

export function decodeKey(b: Uint8Array | readonly number[]): KeyAction {
  const [t, p1, p2, p3] = [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0];
  if (t === 0 && !p1 && !p2 && !p3) return { kind: 'default' };
  if (t === 2 && p1 === 0 && p3 === 0 && p2) return { kind: 'keyboard', usage: p2, modifiers: 0 };
  if (t === 3 && p3 === 0) return { kind: 'consumer', usage: p1 | (p2 << 8) };
  if (t === 1 && p1 === 1 && p3 === 0) {
    const action = Object.entries(MOUSE_BUTTONS).find(([, m]) => m === p2)?.[0];
    if (action) return { kind: 'mouse', action: action as MouseAction };
  }
  if (t === 1 && p1 === 3 && p3 === 0 && (p2 === 1 || p2 === 0xff))
    return { kind: 'mouse', action: p2 === 1 ? 'wheel-up' : 'wheel-down' };
  if (t === 6) {
    const a = decodeCommonSlot([t, p1, p2, p3]);
    if (a?.kind === 'macro') return a;
  }
  return { kind: 'raw', bytes: [t, p1, p2, p3] };
}

export function encodeKey(a: KeyAction): [number, number, number, number] {
  switch (a.kind) {
    case 'default':
      return [0, 0, 0, 0];
    case 'keyboard':
      if (a.modifiers) throw new ProtocolError('Key combinations are not written on these boards.');
      if (a.usage < 1 || a.usage > 0xff) throw new ProtocolError('Key usage out of range.');
      return [2, 0, a.usage, 0];
    case 'consumer':
      if (a.usage < 1 || a.usage > 0xffff) throw new ProtocolError('Media usage out of range.');
      return [3, a.usage & 0xff, a.usage >> 8, 0];
    case 'mouse': {
      if (a.action === 'wheel-up') return [1, 3, 1, 0];
      if (a.action === 'wheel-down') return [1, 3, 0xff, 0];
      const m = MOUSE_BUTTONS[a.action];
      if (!m) throw new ProtocolError(`This keyboard has no “${a.action}” mouse function.`);
      return [1, 1, m, 0];
    }
    case 'macro':
      if (a.index < 0 || a.index >= MACRO_SLOTS) throw new ProtocolError('Macro slot out of range.');
      return encodeCommonSlot(a)!;
    case 'raw':
      return [a.bytes[0] ?? 0, a.bytes[1] ?? 0, a.bytes[2] ?? 0, a.bytes[3] ?? 0];
    default:
      throw new ProtocolError(`These keyboards cannot map a key to “${a.kind}”.`);
  }
}

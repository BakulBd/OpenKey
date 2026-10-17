import { ProtocolError } from '@openkey/core';

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
} as const;

/** Commands OpenKey never sends: firmware download, factory reset, calibration, screen writes. */
export const FORBIDDEN: readonly number[] = [0x4f, 0x0f, 0x50, 0x51];
const ALLOWED = new Set<number>(Object.values(Cmd));

/** Splits a transfer of `data` into request reports for `reportSize`-byte reports. */
export function requests(cmd: number, data: Uint8Array, reportSize: number): Uint8Array[] {
  if (FORBIDDEN.includes(cmd) || !ALLOWED.has(cmd))
    throw new ProtocolError(`Command 0x${cmd.toString(16)} is not sent by OpenKey.`);
  const w = reportSize - HEADER;
  if (w < 1) throw new ProtocolError(`Report size ${reportSize} is too small.`);
  const n = Math.max(1, Math.ceil(data.length / w));
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const addr = i * w;
    const chunk = data.subarray(addr, addr + w);
    const r = new Uint8Array(reportSize);
    r.set([REQUEST, cmd, chunk.length, addr & 0xff, addr >> 8, 0, i === n - 1 ? 1 : 0, 0]);
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

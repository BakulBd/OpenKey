import { ProtocolError } from '@openkey/core';

/**
 * AJAZZ AJ179 mouse ("AJAZZ Driver (X)", device type 105). Facts from Rockeyxx/aj179-linux
 * (MIT; docs/PROTOCOL.md and src/protocol.c), reverse-engineered from the vendor driver and checked
 * on the mouse over the cable and the receiver: one 32-byte output report without a report ID,
 * answered by one 32-byte input report that echoes the command.
 *
 *   byte 0      command (reads 0x10–0x17, writes 0x02–0x07)
 *   byte 1      0 in requests; status in replies (0 ok, 1 no answer through the receiver, 2 asleep)
 *   byte 2      (chunk << 4) | chunks: 0x01 for single writes, 0x00 for reads
 *   byte 3      payload length
 *   byte 4..30  payload
 *   byte 31     sum of bytes 4..30
 *
 * Cable and receiver share one set of settings (checked on hardware by the source).
 */
export const AJ179_PROTOCOL_ID = 'aj179-mouse';
export const REPORT_LEN = 32;

export const AJ179_IDENTITIES: readonly {
  vendorId: number;
  productId: number;
  link: 'usb' | '2.4ghz';
}[] = [
  { vendorId: 0x249a, productId: 0x5c2f, link: '2.4ghz' },
  { vendorId: 0x248a, productId: 0x5c2e, link: 'usb' },
  { vendorId: 0x248a, productId: 0x5d2e, link: 'usb' },
  { vendorId: 0x248a, productId: 0x5e2e, link: 'usb' },
];

export const Cmd = {
  SET_RATE: 0x02,
  SET_DPI: 0x03,
  SET_LIGHTING: 0x05,
  SET_SENSOR: 0x06,
  SET_POWER: 0x07,
  INFO: 0x10,
  GET_RATE: 0x12,
  GET_DPI: 0x13,
  GET_LIGHTING: 0x15,
  GET_SENSOR: 0x16,
  GET_POWER: 0x17,
} as const;

/**
 * Commands OpenKey never sends: macro upload and button mapping (no read-back), the resets
 * (0x0D–0x0F, 0x0F is a factory reset) and anything else not listed above.
 */
const ALLOWED = new Set<number>(Object.values(Cmd));

export const Status = { OK: 0, NO_ANSWER: 1, ASLEEP: 2 } as const;
/** Unsolicited receiver frame: `c0 <online> <battery>`. */
export const STATUS_FRAME = 0xc0;

export function frame(
  cmd: number,
  payload: readonly number[] = [],
  seq = payload.length ? 1 : 0,
): Uint8Array {
  if (!ALLOWED.has(cmd))
    throw new ProtocolError(`AJ179 command 0x${cmd.toString(16)} is not sent by OpenKey.`);
  if (payload.length > 27) throw new ProtocolError('AJ179 payloads are at most 27 bytes');
  const f = new Uint8Array(REPORT_LEN);
  f[0] = cmd;
  f[2] = seq;
  f[3] = payload.length;
  f.set(payload, 4);
  f[31] = f.subarray(4, 31).reduce((a, b) => a + b, 0) & 0xff;
  return f;
}

/** Report rate flags (vendor list builder). */
export const RATES: readonly [number, number][] = [
  [125, 0x08],
  [250, 0x04],
  [500, 0x02],
  [1000, 0x01],
  [2000, 0x10],
  [4000, 0x20],
  [8000, 0x40],
];
export const rateFlag = (hz: number) => RATES.find(([h]) => h === hz)?.[1];
export const rateHz = (flag: number) => RATES.find(([, f]) => f === flag)?.[0];

/**
 * Rates the mouse offers, from the info reply's capability byte. The AJ179 dual mode (the only
 * tested unit) is 125–1000 Hz; faster rates are offered only when the capability byte says so.
 */
export function ratesFor(caps: number): number[] {
  const base = [125, 250, 500, 1000];
  if (caps === 0x40) return [...base, 2000, 4000, 8000];
  if (caps === 0x20) return [...base, 2000, 4000];
  return base;
}

/** Sensor id → DPI range (vendor sync routine). */
export function dpiRange(sensor: number): { min: number; max: number } {
  switch (sensor) {
    case 0x11:
      return { min: 50, max: 18000 };
    case 0x05:
      return { min: 50, max: 12000 };
    case 0x96:
      return { min: 50, max: 32000 };
    case 0x04:
      return { min: 100, max: 8000 };
    case 0x10:
    case 0x12:
      return { min: 100, max: 4800 };
    case 0x25:
      return { min: 100, max: 10000 };
    case 0x26:
      return { min: 200, max: 10000 };
    case 0x35:
      return { min: 100, max: 16000 };
    default:
      return { min: 50, max: 26000 };
  }
}

/** DPI → raw value, per sensor (vendor encoder). PAW3395 (0x95) and unknown sensors: dpi/50 − 1. */
export function dpiEncode(sensor: number, dpi: number): number {
  const d = Math.trunc(dpi);
  switch (sensor) {
    case 0x11:
      if (d >= 13000) return Math.trunc((d - 13000) / 1000) + 221;
      return d > 10000 ? Math.trunc((d - 10000) / 100) + 200 : Math.trunc(d / 50);
    case 0x05:
      return d > 6400 ? Math.trunc((d - 6400) / 100) + 128 : Math.trunc(d / 50);
    case 0x25:
      return d > 5000 ? Math.trunc((d - 5000) / 500) + 50 : Math.trunc(d / 100);
    case 0x26:
      return d > 5000 ? Math.trunc((d - 5000) / 500) + 50 : Math.trunc(d / 100) - 1;
    case 0x96:
      return d > 26000 ? Math.trunc((d - 26000) / 1000) + 519 : Math.trunc(d / 50) - 1;
    case 0x04:
    case 0x10:
    case 0x12:
    case 0x35:
      return Math.trunc(d / 100);
    default:
      return Math.trunc(d / 50) - 1;
  }
}

/**
 * Raw value → DPI, the inverse of `dpiEncode`. For sensor 0x96 the vendor's decoder is one step off
 * above 26000 DPI (it shows 29000 for the value it wrote for 30000); OpenKey shows what was written.
 */
export function dpiDecode(sensor: number, raw: number): number {
  switch (sensor) {
    case 0x11:
      if (raw < 200) return raw * 50;
      return raw <= 220 ? (raw - 100) * 100 : (raw - 208) * 1000;
    case 0x05:
      return raw >= 129 ? (raw - 64) * 100 : raw * 50;
    case 0x25:
      return raw >= 50 ? (raw - 40) * 500 : raw * 100;
    case 0x26:
      return raw >= 50 ? (raw - 39) * 500 : raw * 100;
    case 0x96:
      return raw >= 520 ? (raw - 493) * 1000 : (raw + 1) * 50;
    case 0x04:
    case 0x10:
    case 0x12:
    case 0x35:
      return raw * 100;
    default:
      return (raw + 1) * 50;
  }
}

export interface Aj179Info {
  /** Device id, e.g. "M179". */
  id: string;
  /** Firmware bytes 8–9 (`41 01` over the cable, zero through the receiver). */
  firmware: string | null;
  sensor: number;
  rateCaps: number;
  charging: boolean;
  battery: number;
  /** False when only the receiver answered (mouse asleep or out of range). */
  connected: boolean;
}

export function decodeInfo(r: Uint8Array): Aj179Info {
  const fw = r[8] || r[9] ? `${r[8]!.toString(16)}.${r[9]!.toString(16).padStart(2, '0')}` : null;
  return {
    id: String.fromCharCode(...r.subarray(4, 8)).replace(/[^\x20-\x7e]/g, ''),
    firmware: fw,
    sensor: r[10]!,
    rateCaps: r[11]!,
    charging: r[12] === 1,
    battery: r[13]!,
    connected: r[14] !== 0,
  };
}

export const DPI_LEVELS = 6;

export interface DpiStages {
  index: number;
  count: number;
  dpi: number[];
}

export function decodeDpi(r: Uint8Array, sensor: number): DpiStages {
  return {
    index: r[4]! >> 4,
    count: r[4]! & 0x0f,
    dpi: Array.from({ length: DPI_LEVELS }, (_, i) =>
      dpiDecode(sensor, r[5 + 4 * i]! | (r[6 + 4 * i]! << 8)),
    ),
  };
}

/** DPI stages; X and Y get the same value, as in the vendor driver. */
export function encodeDpi(sensor: number, s: DpiStages): Uint8Array {
  if (s.count < 1 || s.count > DPI_LEVELS || s.index < 0 || s.index >= s.count)
    throw new ProtocolError('The active DPI level must be one of the enabled levels.');
  const { min, max } = dpiRange(sensor);
  const p = new Array<number>(25).fill(0);
  p[0] = (s.index << 4) | s.count;
  s.dpi.forEach((d, i) => {
    if (d < min || d > max) throw new ProtocolError(`Each DPI level must be ${min}–${max}.`);
    const raw = dpiEncode(sensor, d);
    p[1 + 4 * i] = p[3 + 4 * i] = raw & 0xff;
    p[2 + 4 * i] = p[4 + 4 * i] = raw >> 8;
  });
  return frame(Cmd.SET_DPI, p);
}

/** Lighting modes the vendor driver enables for the AJ179, plus neon (a rainbow, hidden there). */
export const Light = { OFF: 0, BREATHING: 2, CONSTANT: 3, NEON: 4 } as const;
/** The seven colours the vendor driver sends with breathing. */
const BREATHING_PALETTE = [
  0xff, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0xff, 0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff,
  0x00, 0xff, 0xff, 0xff, 0xff,
];

export interface Aj179Lighting {
  mode: number;
  /** 0–4 */
  brightness: number;
  /** 0–4 */
  speed: number;
  color: { r: number; g: number; b: number };
}

export function decodeLighting(r: Uint8Array): Aj179Lighting {
  return {
    mode: r[4]!,
    brightness: r[5]! >> 4,
    speed: r[5]! & 0x0f,
    color: { r: r[6]!, g: r[7]!, b: r[8]! },
  };
}

export function encodeLighting(l: Aj179Lighting): Uint8Array {
  if (![0, 1, 2, 3, 4].includes(l.brightness) || ![0, 1, 2, 3, 4].includes(l.speed))
    throw new ProtocolError('Brightness and speed are 0–4.');
  const bs = (l.brightness << 4) | l.speed;
  switch (l.mode) {
    case Light.OFF:
    case Light.NEON:
      return frame(Cmd.SET_LIGHTING, [l.mode, bs]);
    case Light.CONSTANT:
      return frame(Cmd.SET_LIGHTING, [l.mode, bs, l.color.r, l.color.g, l.color.b]);
    case Light.BREATHING:
      return frame(Cmd.SET_LIGHTING, [l.mode, bs, 7, ...BREATHING_PALETTE]);
    default:
      throw new ProtocolError(`Lighting mode ${l.mode} is not offered for the AJ179.`);
  }
}

/** Bytes of a lighting reply that a write must reproduce: mode and levels, plus the colour when constant. */
export const lightingBytes = (mode: number) => (mode === Light.CONSTANT ? 5 : 2);

export interface Aj179Sensor {
  /** 1 = 1 mm, 2 = 2 mm. */
  liftOff: number;
  motionSync: boolean;
  angleSnap: boolean;
}

export const decodeSensor = (r: Uint8Array): Aj179Sensor => ({
  liftOff: r[4]!,
  motionSync: r[5] === 1,
  angleSnap: r[6] === 1,
});

export function encodeSensor(s: Aj179Sensor): Uint8Array {
  if (s.liftOff !== 1 && s.liftOff !== 2)
    throw new ProtocolError('Lift-off distance is 1 or 2 mm.');
  return frame(Cmd.SET_SENSOR, [s.liftOff, s.motionSync ? 1 : 0, s.angleSnap ? 1 : 0, 0, 0]);
}

/** Sleep in 10-second steps: the vendor's own list (10 s … 30 min); factory value 30 = 5 min. */
export const SLEEP_STEPS: readonly { value: number; label: string }[] = [
  { value: 1, label: '10 s' },
  { value: 3, label: '30 s' },
  { value: 6, label: '1 min' },
  { value: 12, label: '2 min' },
  { value: 30, label: '5 min' },
  { value: 60, label: '10 min' },
  { value: 120, label: '20 min' },
  { value: 180, label: '30 min' },
];
export const DEBOUNCE_MS = { min: 0, max: 20 } as const;

export interface Aj179Power {
  sleep: number;
  wakeOnMove: boolean;
  lightsOffOnMove: boolean;
  debounceMs: number;
}

export const decodePower = (r: Uint8Array): Aj179Power => ({
  sleep: r[4]!,
  wakeOnMove: r[5] === 1,
  lightsOffOnMove: r[6] === 1,
  debounceMs: r[7]!,
});

export function encodePower(p: Aj179Power): Uint8Array {
  if (!SLEEP_STEPS.some((o) => o.value === p.sleep))
    throw new ProtocolError('Sleep must be one of the offered times.');
  if (
    !Number.isInteger(p.debounceMs) ||
    p.debounceMs < DEBOUNCE_MS.min ||
    p.debounceMs > DEBOUNCE_MS.max
  )
    throw new ProtocolError(`Debounce must be ${DEBOUNCE_MS.min}–${DEBOUNCE_MS.max} ms.`);
  return frame(Cmd.SET_POWER, [
    p.sleep,
    p.wakeOnMove ? 1 : 0,
    p.lightsOffOnMove ? 1 : 0,
    p.debounceMs,
  ]);
}

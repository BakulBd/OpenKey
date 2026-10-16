import { ProtocolError } from '@openkey/core';

/**
 * AJAZZ AJ139 V2 MC mouse (YJX firmware, "YJX.co.mouse" info string). Facts from
 * Ripariav/Ajazz-AJ139V2MC-Linux-Driver PROTOCOL.md and ajazz-ctl.py (MIT), captured from the
 * vendor's own web configurator: one 64-byte output report (report ID 0) on the FF01 interface,
 * answered by one 64-byte input report.
 *
 * The settings are one block: the live read returns it, and the write replaces all of it. OpenKey
 * therefore always writes the block it just read with only the changed fields replaced (the source
 * warns that writing from defaults silently resets everything else), and checks the device's reply.
 */
export const YJX_PROTOCOL_ID = 'yjx-mouse';
export const YJX_USAGE_PAGE = 0xff01;
export const YJX_IDENTITIES: readonly {
  vendorId: number;
  productId: number;
  link: 'usb' | '2.4ghz';
}[] = [
  { vendorId: 0xa8a4, productId: 0x2255, link: 'usb' },
  { vendorId: 0xa8a5, productId: 0x2255, link: '2.4ghz' },
];
export const REPORT_SIZE = 64;

/** Requests (payload without the report ID). */
export const READ_CONFIG = [0x55, 0x0e, 0xa5, 0x0b, 0x2f, 0x01, 0x01, 0x00, 0x00, 0x00];
export const WRITE_HEADER = [0x55, 0x0f, 0xae, 0x0a, 0x2f, 0x01, 0x01, 0x00, 0x00];
export const READ_BATTERY = [0x55, 0x30, 0xa5, 0x0b, 0x2e, 0x01, 0x01, 0x00, 0x00, 0x00];
export const READ_INFO = [0x55, 0x03];

/** Field offsets in the settings block (same in the read reply and the write request). */
export const Field = {
  LIGHT: 9,
  RATE: 10,
  DPI_COUNT: 11,
  DPI_INDEX: 12,
  DPI: 13,
  SCROLL: 48,
  LIFT_OFF: 49,
  SENSOR: 50,
  DEBOUNCE: 51,
  SLEEP: 52,
  HIGH_SPEED: 53,
  WAKE: 54,
} as const;

export const POLLING_RATES = [125, 250, 500, 1000, 2000] as const;
export const SLEEP_MINUTES = [1, 3, 5, 10, 20, 30, 60] as const;
/** Debounce range OpenKey offers: the firmware's range is not documented (factory value 4 ms). */
export const DEBOUNCE_MS = { min: 1, max: 20 } as const;
export const DPI_LEVELS = 6;

export interface YjxMouseConfig {
  pollingRate: number;
  /** DPI of each of the six levels. */
  dpi: number[];
  /** Number of levels the DPI button cycles through. */
  dpiCount: number;
  /** Active level, 0-based. */
  dpiIndex: number;
  debounceMs: number;
  sleepMinutes: number;
  /** Wake by a click instead of by movement. */
  wakeOnClick: boolean;
  scrollInverted: boolean;
  /** Read-only here: their meaning is not fully documented. */
  liftOff: number;
  lightMode: number;
}

const u16 = (b: ArrayLike<number>, at: number) => b[at]! | (b[at + 1]! << 8);

/** Reads a settings block (the reply to READ_CONFIG or to a write). */
export function decodeConfig(b: Uint8Array): YjxMouseConfig {
  if (b.length < 55) throw new ProtocolError('The mouse settings reply is too short.');
  return {
    pollingRate: POLLING_RATES[b[Field.RATE]! - 1] ?? 0,
    dpi: Array.from({ length: DPI_LEVELS }, (_, i) => u16(b, Field.DPI + i * 2)),
    dpiCount: b[Field.DPI_COUNT]!,
    dpiIndex: b[Field.DPI_INDEX]! - 1,
    debounceMs: b[Field.DEBOUNCE]!,
    sleepMinutes: b[Field.SLEEP]!,
    wakeOnClick: b[Field.WAKE] === 1,
    scrollInverted: b[Field.SCROLL] === 1,
    liftOff: b[Field.LIFT_OFF]!,
    lightMode: b[Field.LIGHT]!,
  };
}

/** Checks a value before it is written; throws with the reason. */
export function validateConfig(c: YjxMouseConfig): void {
  if (!POLLING_RATES.includes(c.pollingRate as (typeof POLLING_RATES)[number]))
    throw new ProtocolError(`Polling rate must be one of ${POLLING_RATES.join(', ')} Hz.`);
  if (
    !Number.isInteger(c.debounceMs) ||
    c.debounceMs < DEBOUNCE_MS.min ||
    c.debounceMs > DEBOUNCE_MS.max
  )
    throw new ProtocolError(`Debounce must be ${DEBOUNCE_MS.min}–${DEBOUNCE_MS.max} ms.`);
  if (!SLEEP_MINUTES.includes(c.sleepMinutes as (typeof SLEEP_MINUTES)[number]))
    throw new ProtocolError(`Sleep must be one of ${SLEEP_MINUTES.join(', ')} minutes.`);
  if (c.dpi.length !== DPI_LEVELS || c.dpi.some((d) => !Number.isInteger(d) || d < 50 || d > 30000))
    throw new ProtocolError('Each DPI level must be 50–30000.');
  if (c.dpiCount < 1 || c.dpiCount > DPI_LEVELS || c.dpiIndex < 0 || c.dpiIndex >= c.dpiCount)
    throw new ProtocolError('The active DPI level must be one of the enabled levels.');
}

/**
 * The write request: the block just read from the mouse (unknown bytes kept as they are), with the
 * known fields set from `c`.
 */
export function encodeWrite(read: Uint8Array, c: YjxMouseConfig): Uint8Array {
  validateConfig(c);
  const out = new Uint8Array(REPORT_SIZE);
  out.set(read.subarray(0, REPORT_SIZE));
  out.set(WRITE_HEADER, 0);
  out[Field.RATE] = POLLING_RATES.indexOf(c.pollingRate as (typeof POLLING_RATES)[number]) + 1;
  out[Field.DPI_COUNT] = c.dpiCount;
  out[Field.DPI_INDEX] = c.dpiIndex + 1;
  c.dpi.forEach((d, i) => {
    out[Field.DPI + i * 2] = d & 0xff;
    out[Field.DPI + i * 2 + 1] = d >> 8;
  });
  out[Field.SCROLL] = c.scrollInverted ? 1 : 0;
  out[Field.DEBOUNCE] = c.debounceMs;
  out[Field.SLEEP] = c.sleepMinutes;
  out[Field.WAKE] = c.wakeOnClick ? 1 : 0;
  return out;
}

/** True when `reply` answers `request` (aa + the request's two command bytes). */
export const answers = (reply: Uint8Array, request: readonly number[]) =>
  reply[0] === 0xaa && reply[1] === request[1] && reply[2] === request[2];

import { Confidence, clamp } from '@openkey/core';
import type {
  Direction,
  EffectCatalog,
  EffectDescriptor,
  PerKeyRgb,
  Rgb,
  RgbConfig,
} from '@openkey/core';
import {
  MONO_TABLE_BYTES,
  PACKET_SIZE,
  REALTIME_BYTES,
  TABLE_BYTES,
  TABLE_SLOTS,
} from '../constants.js';
import { withTrailer } from '../frame.js';
import {
  decodePerKeyEntries,
  encodePerKeyEntries,
  perKeyEntriesValid,
} from '../../common/per-key.js';

/**
 * Lighting data packet (FUN_0042b100, field order from the light page populate code FUN_0042ab40):
 * [0]=effect [1..3]=R,G,B [8]=colorful [9]=brightness [10]=speed [11]=direction [14..15]=AA 55
 */
export const LIGHT_OFFSETS = {
  effect: 0,
  r: 1,
  g: 2,
  b: 3,
  colorful: 8,
  brightness: 9,
  speed: 10,
  direction: 11,
  trailer: 14,
} as const;

/** Radio-button wiring in FUN_0042ab40/FUN_00438xxx: right=1/left=0 (horizontal), up=2/down=3 (vertical). */
export const DIRECTION_CODES: Record<Direction, number> = { left: 0, right: 1, up: 2, down: 3 };
export const DIRECTION_CONFIDENCE = Confidence.STRONGLY_SUPPORTED;

type Ctl = EffectDescriptor['controls'];
const H: Direction[] = ['left', 'right'];
const HV: Direction[] = ['left', 'right', 'up', 'down'];
const full = (direction: Direction[] = []): Ctl => ({
  color: true,
  colorful: true,
  brightness: true,
  speed: true,
  direction,
});
const bsOnly: Ctl = { color: false, colorful: false, brightness: true, speed: true, direction: [] };

/**
 * Effect ids and names: official language table entries 521–540 (Static … Shuttle, LED Off) in the
 * order the Windows-protocol firmware family uses (0 = off, 1 = static … 0x13 = shuttle).
 * Which controls each effect honours comes from community testing on the AK820 Pro and is INFERRED.
 */
export const SONIX_FEATURE_EFFECTS: EffectDescriptor[] = [
  {
    id: 0x00,
    name: 'LED Off',
    controls: { color: false, colorful: false, brightness: false, speed: false, direction: [] },
  },
  { id: 0x01, name: 'Static', controls: { ...full(), speed: false } },
  { id: 0x02, name: 'Single On', controls: full() },
  { id: 0x03, name: 'Single Off', controls: full() },
  { id: 0x04, name: 'Glittering', controls: full() },
  { id: 0x05, name: 'Falling', controls: full() },
  { id: 0x06, name: 'Colourful', controls: bsOnly },
  { id: 0x07, name: 'Breath', controls: full() },
  { id: 0x08, name: 'Spectrum', controls: bsOnly },
  { id: 0x09, name: 'Outward', controls: full() },
  { id: 0x0a, name: 'Scrolling', controls: full(HV) },
  { id: 0x0b, name: 'Rolling', controls: full(H) },
  { id: 0x0c, name: 'Rotating', controls: full(H) },
  { id: 0x0d, name: 'Explode', controls: full() },
  { id: 0x0e, name: 'Launch', controls: full() },
  { id: 0x0f, name: 'Ripples', controls: full() },
  { id: 0x10, name: 'Flowing', controls: full(H) },
  { id: 0x11, name: 'Pulsating', controls: full() },
  { id: 0x12, name: 'Tilt', controls: full(H) },
  { id: 0x13, name: 'Shuttle', controls: full(H) },
];

export function effectCatalog(brightnessMax: number, speedMax: number): EffectCatalog {
  return {
    effects: SONIX_FEATURE_EFFECTS,
    // The official sliders run 0..max (light_mode default_brightness=5, brightness_max=5).
    brightness: { min: 0, max: brightnessMax },
    speed: { min: 0, max: speedMax },
    offEffect: 0x00,
    customEffect: 0x80,
  };
}

export function encodeLightingData(cfg: RgbConfig, catalog: EffectCatalog): Uint8Array {
  const p = new Uint8Array(PACKET_SIZE);
  p[LIGHT_OFFSETS.effect] = cfg.effect & 0xff;
  p[LIGHT_OFFSETS.r] = clamp(cfg.color.r, 0, 255);
  p[LIGHT_OFFSETS.g] = clamp(cfg.color.g, 0, 255);
  p[LIGHT_OFFSETS.b] = clamp(cfg.color.b, 0, 255);
  p[LIGHT_OFFSETS.colorful] = cfg.colorful ? 1 : 0;
  p[LIGHT_OFFSETS.brightness] = clamp(
    cfg.brightness,
    catalog.brightness.min,
    catalog.brightness.max,
  );
  p[LIGHT_OFFSETS.speed] = clamp(cfg.speed, catalog.speed.min, catalog.speed.max);
  p[LIGHT_OFFSETS.direction] = DIRECTION_CODES[cfg.direction];
  return withTrailer(p, LIGHT_OFFSETS.trailer);
}

export function decodeLightingData(p: Uint8Array): RgbConfig {
  const dir =
    (Object.entries(DIRECTION_CODES) as [Direction, number][]).find(
      ([, v]) => v === p[LIGHT_OFFSETS.direction],
    )?.[0] ?? 'left';
  return {
    effect: p[LIGHT_OFFSETS.effect] ?? 0,
    color: { r: p[LIGHT_OFFSETS.r] ?? 0, g: p[LIGHT_OFFSETS.g] ?? 0, b: p[LIGHT_OFFSETS.b] ?? 0 },
    colorful: p[LIGHT_OFFSETS.colorful] === 1,
    brightness: p[LIGHT_OFFSETS.brightness] ?? 0,
    speed: p[LIGHT_OFFSETS.speed] ?? 0,
    direction: dir,
  };
}

/** Mode-only packet used to switch to the per-key table (FUN_0044b900 writes dword 0x80, byte 8 = 0). */
export function customModePacket(effect: number): Uint8Array {
  const p = new Uint8Array(PACKET_SIZE);
  p[0] = effect & 0xff;
  return p;
}

/** Per-key table (FUN_0044ba10 RGB branch): entry n = [n, R, G, B], trailer at 574. */
export function encodePerKeyTable(colors: PerKeyRgb): Uint8Array {
  const valid: PerKeyRgb = {};
  for (const [k, v] of Object.entries(colors))
    if (Number(k) > 0 && Number(k) < TABLE_SLOTS - 1) valid[Number(k)] = v;
  const buf = new Uint8Array(TABLE_BYTES);
  buf.set(encodePerKeyEntries(valid, TABLE_SLOTS));
  return withTrailer(buf);
}

/** Reads entries written by encodePerKeyTable / returned by READ_PER_KEY_RGB (FUN_0042aee0). */
export function decodePerKeyTable(buf: Uint8Array, validIndices?: Iterable<number>): PerKeyRgb {
  return decodePerKeyEntries(
    buf,
    validIndices ?? Array.from({ length: TABLE_SLOTS - 2 }, (_, i) => i + 1),
  );
}

/** Structural check used on read-back: entry n starts with n (or 0 for unused slots). */
export const perKeyTableLooksValid = perKeyEntriesValid;

/** Single-colour boards: 192-byte table, 0xFF marks a lit key. Kept for completeness. */
export function encodeMonoTable(lit: Iterable<number>): Uint8Array {
  const buf = new Uint8Array(MONO_TABLE_BYTES);
  for (const n of lit) if (n > 0 && n < MONO_TABLE_BYTES - 2) buf[n] = 0xff;
  return withTrailer(buf);
}

/** Real-time stream (FUN_004329e0): packed [led, R, G, B] entries, 512 bytes. */
export function encodeRealtimeTable(colors: [number, Rgb][]): Uint8Array {
  const buf = new Uint8Array(REALTIME_BYTES);
  colors.slice(0, REALTIME_BYTES / 4).forEach(([led, c], i) => {
    buf.set([led & 0xff, c.r & 0xff, c.g & 0xff, c.b & 0xff], i * 4);
  });
  return buf;
}

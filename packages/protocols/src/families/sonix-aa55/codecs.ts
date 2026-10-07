import { ProtocolError, clamp, u16le } from '@openak820/core';
import type {
  Direction,
  KeyAction,
  KeymapState,
  Macro,
  MacroEvent,
  RgbConfig,
} from '@openak820/core';
import { decodeCommonSlot, encodeCommonSlot } from '../common/key-slot.js';
import type { Slot } from '../common/key-slot.js';
import {
  KEY_SLOTS,
  KEY_TABLE_BYTES,
  LED_EFFECT_BYTES,
  MACRO_INDEX_BYTES,
  MACRO_SLOTS,
} from './constants.js';

/** `_n`: GET_DEVICE_INFO, 48 bytes. */
export interface Aa55DeviceInfo {
  romSize: number;
  macroSpaceSize: number;
  vid: number;
  pid: number;
  version: string;
  sensor: number;
  manufacturer: number;
  product: number;
  workMode: number;
  batteryLevel: number;
  chargeStatus: number;
  currentProfile: number;
  axisInfo: number;
  tftMaxFrames: number;
  gifMaxFrames: number;
  ledMaxFrames: number;
  tftDirection: number;
  rtPrecision: number;
  frameVersion: number;
  lightingVersion: number;
  firmwareStatus: number;
}

export function decodeDeviceInfo(n: Uint8Array): Aa55DeviceInfo {
  const v = ((n[8]! & 15) + ((n[8]! & 240) >> 4) * 10 + n[9]! * 100) / 100;
  return {
    romSize: n[0]!,
    macroSpaceSize: u16le(n, 2),
    vid: u16le(n, 4),
    pid: u16le(n, 6),
    version: v.toFixed(2),
    sensor: u16le(n, 10),
    manufacturer: u16le(n, 12),
    product: u16le(n, 14),
    workMode: n[16]!,
    batteryLevel: n[17]!,
    chargeStatus: n[18]!,
    currentProfile: n[19]!,
    axisInfo: u16le(n, 20),
    tftMaxFrames: u16le(n, 22),
    gifMaxFrames: u16le(n, 24),
    ledMaxFrames: u16le(n, 26),
    tftDirection: n[28]!,
    rtPrecision: n[29]!,
    frameVersion: n[30]!,
    lightingVersion: n[31]!,
    firmwareStatus: n[32]!,
  };
}

/** `wn`/`bd`: game-mode/settings struct, 56 bytes. */
export interface Aa55GameMode {
  gameMode: number;
  fnSwitch: number;
  sleepTime: number;
  keyDelay: number;
  reportRate: number;
  systemMode: number;
  tftDisplayTime: number;
  topDeadZone: number;
  bottomDeadZone: number;
  stabilityMode: number;
  autoCalibration: number;
  singleKeyWakeup: number;
  pushButtonMode: number;
  nkroSwitch: number;
  wirelessReportRate: number;
  /** Bytes OpenAK820 does not interpret, preserved on write. */
  raw: number[];
}

export function decodeGameMode(m: Uint8Array): Aa55GameMode {
  return {
    gameMode: m[1]!,
    fnSwitch: m[2]!,
    sleepTime: m[3]!,
    keyDelay: m[4]!,
    reportRate: m[5]!,
    systemMode: m[6]!,
    tftDisplayTime: m[7]!,
    topDeadZone: m[8]! / 100,
    bottomDeadZone: m[9]! / 100,
    stabilityMode: m[11]!,
    autoCalibration: m[14]!,
    singleKeyWakeup: m[15]!,
    pushButtonMode: m[16]!,
    nkroSwitch: m[17]!,
    wirelessReportRate: u16le(m, 18),
    raw: Array.from(m),
  };
}

export function encodeGameMode(g: Aa55GameMode): Uint8Array {
  // Start from the bytes read from the device so unknown fields survive.
  const n = Uint8Array.from(g.raw.length === 56 ? g.raw : new Array(56).fill(0));
  n[1] = g.gameMode;
  n[2] = g.fnSwitch;
  n[3] = g.sleepTime;
  n[4] = g.keyDelay;
  n[5] = g.reportRate;
  n[6] = g.systemMode;
  n[7] = g.tftDisplayTime;
  n[8] = Math.round(g.topDeadZone * 100);
  n[9] = Math.round(g.bottomDeadZone * 100);
  n[11] = g.stabilityMode;
  n[14] = g.autoCalibration;
  n[15] = g.singleKeyWakeup;
  n[16] = g.pushButtonMode;
  n[17] = g.nkroSwitch;
  n[18] = g.wirelessReportRate & 0xff;
  n[19] = (g.wirelessReportRate >> 8) & 0xff;
  return n;
}

/** `Fn`/`zd`: LED effect, 16 bytes. Byte 4 (driverSetting) is always written as 0xFF. */
export const LED_OFFSETS = {
  mode: 0,
  r: 1,
  g: 2,
  b: 3,
  driverSetting: 4,
  r2: 5,
  g2: 6,
  b2: 7,
  colorMode: 8,
  brightness: 9,
  speed: 10,
  direction: 11,
  effectModeType: 12,
} as const;
/** Direction values used by the online UI (wsclx/ak820pro-modder, INFERRED). */
export const AA55_DIRECTIONS: Record<Direction, number> = { left: 0, down: 1, up: 2, right: 3 };

export function encodeLedEffect(
  c: RgbConfig,
  extra: { secondary?: { r: number; g: number; b: number }; effectModeType?: number } = {},
): Uint8Array {
  const n = new Uint8Array(LED_EFFECT_BYTES);
  n[0] = c.effect;
  n[1] = clamp(c.color.r, 0, 255);
  n[2] = clamp(c.color.g, 0, 255);
  n[3] = clamp(c.color.b, 0, 255);
  n[4] = 0xff;
  n[5] = extra.secondary?.r ?? 0;
  n[6] = extra.secondary?.g ?? 0;
  n[7] = extra.secondary?.b ?? 0;
  n[8] = c.colorful ? 1 : 0;
  n[9] = c.brightness;
  n[10] = c.speed;
  n[11] = AA55_DIRECTIONS[c.direction];
  n[12] = extra.effectModeType ?? 0;
  n[14] = 0xaa;
  n[15] = 0x55;
  return n;
}

export function decodeLedEffect(m: Uint8Array): RgbConfig {
  const direction =
    (Object.entries(AA55_DIRECTIONS) as [Direction, number][]).find(([, v]) => v === m[11])?.[0] ??
    'left';
  return {
    effect: m[0]!,
    color: { r: m[1]!, g: m[2]!, b: m[3]! },
    colorful: m[8]! !== 0,
    brightness: m[9]!,
    speed: m[10]!,
    direction,
  };
}

/** Online-family slot codec: common pages plus raw passthrough for FUNC/TGL/… pages. */
export function encodeSlotAa55(a: KeyAction): Slot {
  const s = encodeCommonSlot(a);
  if (s) return s;
  throw new ProtocolError(
    `Key action "${a.kind}" is not supported by the online-driver encoder in OpenAK820`,
  );
}

export function decodeSlotAa55(bytes: ArrayLike<number>): KeyAction {
  return decodeCommonSlot(bytes) ?? { kind: 'raw', bytes: Array.from(bytes).slice(0, 4) };
}

export function encodeKeyTable(state: KeymapState): Uint8Array {
  const buf = new Uint8Array(KEY_TABLE_BYTES);
  for (const [k, a] of Object.entries(state.slots)) {
    const slot = Number(k);
    if (slot < 0 || slot >= KEY_SLOTS) throw new ProtocolError(`Key slot ${k} out of range`);
    buf.set(encodeSlotAa55(a), slot * 4);
  }
  return buf;
}

export function decodeKeyTable(buf: Uint8Array, layer: KeymapState['layer']): KeymapState {
  const slots: Record<number, KeyAction> = {};
  for (let s = 0; s < KEY_SLOTS; s++) {
    const a = decodeSlotAa55(buf.subarray(s * 4, s * 4 + 4));
    if (a.kind !== 'default') slots[s] = a;
  }
  return { layer, slots, provenance: 'device' };
}

/**
 * Macro storage (`Rn`/`ek`): 400-byte index of u32 offsets (0 = empty), blocks at offset ≥400:
 * header [u16 count×2, 0, 0], then 4-byte actions [delay lo, delay hi, keyCode, flags]
 * flags: keyboard B0/30, mouse 90/10 (bit 7 = press).
 */
export function encodeMacrosAa55(macros: Macro[]): { index: Uint8Array; data: Uint8Array } {
  const index = new Uint8Array(MACRO_INDEX_BYTES);
  const blocks: Uint8Array[] = [];
  let offset = MACRO_INDEX_BYTES;
  for (const m of [...macros].sort((a, b) => a.index - b.index)) {
    if (m.index < 0 || m.index >= MACRO_SLOTS)
      throw new ProtocolError(`Macro slot ${m.index} out of range`);
    const actions = toActions(m.events);
    if (!actions.length) continue;
    const block = new Uint8Array(4 + actions.length * 4);
    const count = actions.length * 2;
    block[0] = count & 0xff;
    block[1] = (count >> 8) & 0xff;
    actions.forEach((a, i) => block.set(a, 4 + i * 4));
    new DataView(index.buffer).setUint32(m.index * 4, offset, true);
    blocks.push(block);
    offset += block.length;
  }
  const data = new Uint8Array(offset - MACRO_INDEX_BYTES);
  let o = 0;
  for (const b of blocks) {
    data.set(b, o);
    o += b.length;
  }
  return { index, data };
}

function toActions(events: MacroEvent[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'delay') continue;
    const next = events[i + 1];
    const delay = next?.type === 'delay' ? Math.min(0xffff, next.ms) : 0;
    if (e.type === 'key')
      out.push(Uint8Array.of(delay & 0xff, delay >> 8, e.usage & 0xff, e.down ? 0xb0 : 0x30));
    else
      out.push(
        Uint8Array.of(
          delay & 0xff,
          delay >> 8,
          e.button === 'left' ? 1 : e.button === 'right' ? 2 : 4,
          e.down ? 0x90 : 0x10,
        ),
      );
  }
  return out;
}

export function decodeMacroBlock(actions: Uint8Array, count: number): MacroEvent[] {
  const events: MacroEvent[] = [];
  for (let i = 0; i < count; i++) {
    const a = actions.subarray(i * 4, i * 4 + 4);
    const flags = a[3]!;
    const press = (flags & 0x80) !== 0;
    const type = (flags >> 4) & 7;
    if (type === 1 || type === 2)
      events.push({
        type: 'mouse',
        button: a[2] === 1 ? 'left' : a[2] === 2 ? 'right' : 'middle',
        down: press,
      });
    else events.push({ type: 'key', usage: a[2]!, down: press });
    const delay = a[0]! | (a[1]! << 8);
    if (delay) events.push({ type: 'delay', ms: delay });
  }
  return events;
}

/**
 * TFT animation (`ik`): 256-byte header 0xFF-filled, [0]=frames, [1+i]=delay_i×5 for i<N−1,
 * [N]=0, then RGB565 LE frames. The UI's delay field defaults to 10 (≈100 ms), so one header
 * unit ≈ 2 ms like the Windows-protocol firmware (INFERRED).
 */
export function buildAa55TftPayload(delaysMs: number[], pixels: Uint8Array): Uint8Array {
  const header = new Uint8Array(256).fill(0xff);
  const n = delaysMs.length;
  header[0] = n;
  for (let i = 0; i < n - 1; i++)
    header[i + 1] = Math.max(1, Math.min(255, Math.round(delaysMs[i]! / 2)));
  if (n > 0) header[n] = 0;
  const out = new Uint8Array(256 + pixels.length);
  out.set(header);
  out.set(pixels, 256);
  return out;
}

export function tftChunkHeader(index: number, total: number): Uint8Array {
  return Uint8Array.of(
    0xaa,
    80,
    index & 0xff,
    (index >> 8) & 0xff,
    total & 0xff,
    (total >> 8) & 0xff,
    0x50,
    0x06,
  );
}

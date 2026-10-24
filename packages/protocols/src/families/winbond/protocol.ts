import {
  BaseKeyboardDriver,
  Evidence,
  FeatureStatus,
  ProtocolError,
  SafetyBlockedError,
  SafetyLevel,
  clamp,
  configurable,
  emptyCapabilities,
  feature,
  replyShape,
} from '@openkey/core';
import type {
  Capabilities,
  DiagnosticsDriver,
  ProtocolCheckInfo,
  ProtocolCheckResult,
  DeviceIdentity,
  DeviceInfo,
  Direction,
  EffectCatalog,
  KeyAction,
  KeyActionKind,
  Macro,
  MacroLimits,
  MacroPlayMode,
  KeyboardLayout,
  KeymapState,
  LayerId,
  PerKeyRgb,
  RgbConfig,
  SettingsSchema,
  SystemSettings,
  StateStore,
  TransportMode,
} from '@openkey/core';
import { ansiLayout } from '@openkey/devices';
import { LoggingTransport } from '@openkey/hid';
import type { HidCollection, HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import type {
  CandidateMatch,
  ProbeContext,
  ProbeResult,
  ProtocolDefinition,
} from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';

/**
 * Lighting of Winbond-based gaming keyboards (USB vendor 0416, product string "Gaming Keyboard"):
 * FL Esports MK870, ZET Gaming and siblings. Packet from Mqlvin/keyboard-colour src/usb.rs and
 * src/app.rs (MIT, Copyright (c) 2025 Mqlvin), captured from the vendor software with USBPcap:
 *
 * - vendor collection FF1B:0091, output report 1 of 63 bytes;
 * - `07 00 00 00 0E mode brightness speed R G B R2 G2 B2 direction rainbow`, zero padded;
 * - modes and direction codes below; brightness and speed 0–4;
 * - nothing can be read back.
 *
 * An MK870 owner (0416:C345) reported the source's program working on their keyboard.
 */
export const WINBOND_PROTOCOL_ID = 'winbond-lighting';
export const VENDOR_ID = 0x0416;
export const USAGE_PAGE = 0xff1b;
export const USAGE = 0x91;
export const REPORT_ID = 0x01;
export const REPORT_BYTES = 63;
export const LIGHTING_HEADER = [0x07, 0x00, 0x00, 0x00, 0x0e] as const;
export const PRODUCT_NAME = 'Gaming Keyboard';

export interface WinbondModel {
  vendorId: number;
  productId: number;
  model: string;
  /** Effect codes confirmed for this model; all of `MODES` when absent. */
  effects?: readonly number[];
  /** Features an owner confirmed on this model's hardware (see `fixtures/verification`). */
  verified?: readonly ('rgb' | 'perKeyRgb' | 'keymap' | 'macros')[];
}

/** Owner test of the MK870, OpenKey issue #13 (2026-10-24). */
export const MK870_OWNER_TEST = 'fixtures/verification/mk870-owner-test-issue13.json';

export const MODELS: readonly WinbondModel[] = [
  {
    vendorId: VENDOR_ID,
    productId: 0xc345,
    model: 'FL Esports MK870',
    verified: ['rgb', 'perKeyRgb', 'keymap', 'macros'],
  },
  // Listed by the official FL Esports driver (NUC121); lighting and per-key tested by
  // DanielGibson, whose effect list agrees with the MK870's only on these codes.
  {
    vendorId: VENDOR_ID,
    productId: 0xb23c,
    model: 'Pulsar PCMK TKL / KT108',
    effects: [0x00, 0x01, 0x02, 0x03, 0x06, 0x07, 0x08, 0x0a],
  },
];

export const DIRECTION_CODES: Record<Direction, number> = {
  right: 0x00,
  left: 0x01,
  up: 0x02,
  down: 0x03,
  outwards: 0x04,
  inwards: 0x05,
  clockwise: 0x06,
  anticlockwise: 0x07,
};

const WAVE: Direction[] = ['up', 'down', 'left', 'right', 'inwards', 'outwards'];
const SPIN: Direction[] = ['clockwise', 'anticlockwise'];

/**
 * Effects with the source's names, code, speed and directions; every code but the custom table
 * (0x0A) was captured on an MK870 (fixtures/rgb/mk870-lighting-captures-issue13.json). Music
 * response (0x64) lights to the rhythm of audio the vendor app streams with command 20; without
 * it the keyboard shows the effect's resting state.
 */
export const MODES: readonly { id: number; name: string; speed: boolean; dirs: Direction[] }[] = [
  { id: 0x00, name: 'Static', speed: false, dirs: [] },
  { id: 0x01, name: 'Breathe', speed: true, dirs: [] },
  { id: 0x02, name: 'Wave', speed: true, dirs: WAVE },
  { id: 0x03, name: 'Neon', speed: true, dirs: [] },
  { id: 0x04, name: 'Spiral', speed: true, dirs: SPIN },
  { id: 0x06, name: 'Reactive', speed: true, dirs: [] },
  { id: 0x07, name: 'Aurora', speed: true, dirs: ['inwards', 'outwards'] },
  { id: 0x08, name: 'Ripple', speed: true, dirs: [] },
  { id: 0x09, name: 'Stars', speed: true, dirs: [] },
  { id: 0x0b, name: 'Cross', speed: true, dirs: [] },
  { id: 0x0c, name: 'Typing response', speed: false, dirs: ['up', 'down'] },
  { id: 0x0e, name: 'Auto ripple', speed: true, dirs: [] },
  { id: 0x0f, name: 'Snake', speed: true, dirs: SPIN },
  { id: 0x10, name: 'Fireworks', speed: true, dirs: [] },
  { id: 0x64, name: 'Music response (needs the vendor app’s audio)', speed: false, dirs: [] },
  // Shows the per-key table (Pulsar PCMK notes; the same command family).
  { id: 0x0a, name: 'Custom (per-key colours)', speed: false, dirs: [] },
];

export const LEVEL_MAX = 4;

/**
 * Per-key colours (DanielGibson's Pulsar PCMK TKL notes, 0416:B23C, same command family; facts only):
 * eight output reports `09 00 00 NN LEN <RGB …>`, NN = 0–7, LEN = 0x36 (18 LEDs) or 0x12 for the
 * last (6 LEDs): 132 LEDs, a 6 × 22 grid, row-major. The vendor software never sends a component
 * above 0xC1, so colours are scaled into that range. Effect 0x0A then shows the table.
 */
export const PER_KEY_CMD = 0x09;
export const PER_KEY_PACKETS = 8;
export const LEDS_PER_PACKET = 18;
export const LED_COUNT = 132;
export const COLOR_MAX = 0xc1;
export const CUSTOM_EFFECT = 0x0a;

/**
 * Matrix / LED index of each ANSI key name used by `ansiLayout`: the 6 × 22 grid of the official
 * FL Esports driver's default profile (V1.06.16, `<macro>` list, 132 entries in index order), which
 * the Pulsar PCMK notes match LED by LED.
 */
export const LED_INDEX: Readonly<Record<string, number>> = {
  Esc: 0,
  F1: 2,
  F2: 3,
  F3: 4,
  F4: 5,
  F5: 7,
  F6: 8,
  F7: 9,
  F8: 10,
  F9: 11,
  F10: 12,
  F11: 13,
  F12: 14,
  PrtSc: 15,
  ScrLk: 16,
  Pause: 17,
  '`': 22,
  '1': 23,
  '2': 24,
  '3': 25,
  '4': 26,
  '5': 27,
  '6': 28,
  '7': 29,
  '8': 30,
  '9': 31,
  '0': 32,
  '-': 33,
  '=': 34,
  Backspace: 36,
  Ins: 37,
  Home: 38,
  PgUp: 39,
  Tab: 44,
  Q: 45,
  W: 46,
  E: 47,
  R: 48,
  T: 49,
  Y: 50,
  U: 51,
  I: 52,
  O: 53,
  P: 54,
  '[': 55,
  ']': 56,
  '\\': 58,
  Del: 59,
  End: 60,
  PgDn: 61,
  Caps: 66,
  A: 68,
  S: 69,
  D: 70,
  F: 71,
  G: 72,
  H: 73,
  J: 74,
  K: 75,
  L: 76,
  ';': 77,
  "'": 78,
  Enter: 80,
  LShift: 88,
  Z: 90,
  X: 91,
  C: 92,
  V: 93,
  B: 94,
  N: 95,
  M: 96,
  ',': 97,
  '.': 98,
  '/': 99,
  RShift: 102,
  Up: 104,
  LCtrl: 110,
  LWin: 111,
  LAlt: 112,
  Space: 116,
  RAlt: 120,
  Fn: 121,
  Menu: 122,
  RCtrl: 123,
  Left: 125,
  Down: 126,
  Right: 127,
};

/**
 * Key map (official FL Esports driver V1.06.16, "Write keyboard Onboard-data", decoded from the
 * driver's code; facts only): output report `18 LAYER 00 N LEN <entries>`, LAYER 0 = default
 * layer (1 = FN1, 2 = FN), 14 keys of 4 bytes per packet in matrix order, 132 keys = 10 packets.
 * Entries: `00 USAGE 00 00` for a key, `01 00 00 00` for the Fn key, `00 00 00 00` for nothing.
 */
export const KEYMAP_CMD = 0x18;
export const KEYS_PER_KEYMAP_PACKET = 14;
export const FN_SLOT = 121;
const FN_ENTRY = [0x01, 0x00, 0x00, 0x00] as const;

/** Default layer of the official driver's QWERTY profile, by matrix index (−10 = the Fn key). */
// prettier-ignore
export const DEFAULT_KEYS: readonly number[] = [
  0x29, 0x00, 0x3a, 0x3b, 0x3c, 0x3d, 0x00, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x00, 0x00, 0x00, 0x00,
  0x35, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2d, 0x2e, 0x00, 0x2a, 0x49, 0x4a, 0x4b, 0x53, 0x54, 0x55, 0x56,
  0x2b, 0x14, 0x1a, 0x08, 0x15, 0x17, 0x1c, 0x18, 0x0c, 0x12, 0x13, 0x2f, 0x30, 0x00, 0x31, 0x4c, 0x4d, 0x4e, 0x5f, 0x60, 0x61, 0x57,
  0x39, 0x00, 0x04, 0x16, 0x07, 0x09, 0x0a, 0x0b, 0x0d, 0x0e, 0x0f, 0x33, 0x34, 0x00, 0x28, 0x00, 0x00, 0x00, 0x5c, 0x5d, 0x5e, 0x00,
  0xe1, 0x00, 0x1d, 0x1b, 0x06, 0x19, 0x05, 0x11, 0x10, 0x36, 0x37, 0x38, 0x00, 0x00, 0xe5, 0x00, 0x52, 0x00, 0x59, 0x5a, 0x5b, 0x58,
  0xe0, 0xe3, 0xe2, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0xe6, -10, 0x65, 0xe4, 0x00, 0x50, 0x51, 0x4f, 0x62, 0x00, 0x63, 0x00,
];

/**
 * Media keys: action type 3 of the driver's profiles, written `07 CODE 00 00`. The menu index →
 * code table and the names are the driver's own (index 0–7 match its multimedia menu and the
 * Fn rows of its profiles; Calculator is the dedicated key its profiles map to index 9). Indices
 * whose name the driver's sources disagree on are left out.
 */
export const MEDIA_KEYS: readonly { code: number; label: string }[] = [
  { code: 0x10, label: 'Volume up' },
  { code: 0x11, label: 'Volume down' },
  { code: 0x12, label: 'Mute' },
  { code: 0x13, label: 'Play / pause' },
  { code: 0x14, label: 'Next track' },
  { code: 0x15, label: 'Previous track' },
  { code: 0x16, label: 'Stop' },
  { code: 0x17, label: 'Media player' },
  { code: 0x32, label: 'Calculator' },
];
const MEDIA_ENTRY = 0x07;
/** Key with modifiers (action type 2): `13 MOD1 KEY 00` or `13 MOD1 MOD2 KEY`. */
const COMBO_ENTRY = 0x13;

/** Modifier usages (0xE0–0xE7) in the order the driver takes them from the bitmask. */
const modifierUsages = (mask: number) =>
  Array.from({ length: 8 }, (_, i) => i)
    .filter((i) => mask & (1 << i))
    .map((i) => 0xe0 + i);

/**
 * Macros (official driver, "Write Macro-data list", decoded from its macro uploader): each slot is a
 * 256-byte record sent as five output reports `19 SLOT 00 K LEN …`, K = 0–4, LEN 0x3A (58) for
 * K 0–3 and 0x18 (24) for K 4, each answered by a `19` echo (the driver retries up to four times).
 * The record starts with an 8-byte header — `00 MODE 00 LEN 00 REPEAT 00 00`, MODE 0 play once,
 * 1 play multiple times, 2 toggle, 3 while held; LEN = 4 × events — followed by the events,
 * 4 bytes each: `CODE FLAGS DELAY_HI DELAY_LO`, CODE a HID key usage or mouse button (1 left,
 * 2 right, 4 middle), FLAGS 0x10 for press plus 0x01 for a mouse button, and the delay in ms that
 * follows the event, big-endian. Unused slots are sent as empty records.
 */
export const MACRO_CMD = 0x19;
export const MACRO_SLOTS = 10;
export const MACRO_RECORD_BYTES = 256;
const MACRO_HEADER_BYTES = 8;
export const MACRO_MAX_EVENTS = (MACRO_RECORD_BYTES - MACRO_HEADER_BYTES) / 4;
const MACRO_PACKETS = [0x3a, 0x3a, 0x3a, 0x3a, 0x18] as const;
const MACRO_RETRIES = 4;
const MACRO_ACK_MS = 100;
/** A key bound to macro slot S: `10 01 S 00` (the driver's profiles give every key 1 there). */
const MACRO_ENTRY = 0x10;
export const MACRO_MODES: Record<MacroPlayMode, number> = {
  once: 0,
  repeat: 1,
  toggle: 2,
  'while-held': 3,
};
const MOUSE_CODES = { left: 1, right: 2, middle: 4 } as const;

export const MACRO_LIMITS: MacroLimits = {
  slots: MACRO_SLOTS,
  storageBytes: MACRO_SLOTS * MACRO_RECORD_BYTES,
  minDelayMs: 0,
  maxDelayMs: 0xffff,
};

/** How a slot is played, taken from the key that uses it. */
export interface MacroPlay {
  mode: MacroPlayMode;
  repeat: number;
}

/** The 256-byte record of one macro (8-byte header, 248 bytes of events); delays are folded into the event before them. */
export function macroRecord(macro: Macro | undefined, play: MacroPlay): Uint8Array {
  const record = new Uint8Array(MACRO_RECORD_BYTES);
  if (!macro || macro.events.length === 0) return record;
  const events: number[][] = [];
  for (const e of macro.events) {
    if (e.type === 'delay') {
      const last = events.at(-1);
      if (!last) continue; // nothing to wait after
      const ms = Math.min(0xffff, ((last[2]! << 8) | last[3]!) + Math.max(0, Math.round(e.ms)));
      last[2] = ms >> 8;
      last[3] = ms & 0xff;
      continue;
    }
    const press = e.down ? 0x10 : 0x00;
    if (e.type === 'key') {
      if (e.usage < 0x04 || e.usage > 0xe7)
        throw new ProtocolError(`Macro key 0x${e.usage.toString(16)} cannot be stored.`);
      events.push([e.usage, press, 0, 0]);
    } else events.push([MOUSE_CODES[e.button], press | 0x01, 0, 0]);
  }
  if (events.length > MACRO_MAX_EVENTS)
    throw new ProtocolError(
      `A macro holds at most ${MACRO_MAX_EVENTS} presses and releases on this keyboard (this one has ${events.length}).`,
    );
  const repeat = play.mode === 'repeat' ? clamp(play.repeat, 1, 255) : 1;
  record.set([0x00, MACRO_MODES[play.mode], 0x00, events.length * 4, 0x00, repeat, 0x00, 0x00]);
  record.set(events.flat(), MACRO_HEADER_BYTES);
  return record;
}

/** The five packets of a slot (without the report ID). */
export function macroPackets(slot: number, record: Uint8Array): Uint8Array[] {
  let at = 0;
  return MACRO_PACKETS.map((len, k) => {
    const p = new Uint8Array(REPORT_BYTES);
    p.set([MACRO_CMD, slot, 0x00, k, len]);
    p.set(record.subarray(at, at + len), 5);
    at += len;
    return p;
  });
}

function keyEntry(slot: number, action: KeyAction | undefined): readonly number[] {
  if (slot === FN_SLOT) return FN_ENTRY;
  const a = action ?? { kind: 'default' };
  switch (a.kind) {
    case 'default': {
      const u = DEFAULT_KEYS[slot] ?? 0;
      return [0x00, u > 0 ? u : 0x00, 0x00, 0x00];
    }
    case 'disabled':
      return [0x00, 0x00, 0x00, 0x00];
    case 'keyboard': {
      if (a.usage < 0x04 || a.usage > 0xe7)
        throw new ProtocolError(`HID usage 0x${a.usage.toString(16)} cannot be assigned.`);
      const mods = modifierUsages(a.modifiers & 0xff);
      if (mods.length === 0) return [0x00, a.usage, 0x00, 0x00];
      if (mods.length === 1) return [COMBO_ENTRY, mods[0]!, a.usage, 0x00];
      if (mods.length === 2) return [COMBO_ENTRY, mods[0]!, mods[1]!, a.usage];
      throw new ProtocolError('This keyboard stores at most two modifiers with a key.');
    }
    case 'macro':
      if (a.index < 0 || a.index >= MACRO_SLOTS)
        throw new ProtocolError(
          `Macro ${a.index + 1} is outside the keyboard’s ${MACRO_SLOTS} slots.`,
        );
      return [MACRO_ENTRY, 0x01, a.index, 0x00];
    case 'special':
      if (!MEDIA_KEYS.some((m) => m.code === a.code))
        throw new ProtocolError(
          `Function 0x${a.code.toString(16)} is not one of this keyboard’s media keys.`,
        );
      return [MEDIA_ENTRY, a.code, 0x00, 0x00];
    default:
      throw new ProtocolError(`“${a.kind}” actions are not supported on this keyboard yet.`);
  }
}

/**
 * Factory Fn layers. Writing an Fn layer sends all 132 entries, so every key the user does not
 * change must be sent exactly as the keyboard's factory table has it, or its built-in Fn shortcut
 * is erased. A table is listed here only when it is confirmed for a driver model code: from the
 * official driver's own factory table for that model, or from a USB capture of the official app
 * saving that layer. Each table is the 132 four-byte entries in matrix order.
 *
 * The MK870's model code is not known yet (Device Lab → Report → Run all checks), and its table is
 * not confirmed, so this list is empty and Fn-layer writes stay off. Nothing here is guessed.
 */
export type FnFactoryTable = readonly (readonly [number, number, number, number])[];
export const FN_FACTORY_TABLES = new Map<string, { fn1: FnFactoryTable; fn2?: FnFactoryTable }>();

/** The ten key-map packets of one layer (without the report ID). */
export function keymapPackets(
  layer: number,
  slots: Record<number, KeyAction>,
  factory?: FnFactoryTable,
): Uint8Array[] {
  const entries = DEFAULT_KEYS.map((_, i) =>
    // On an Fn layer, an unchanged key keeps the factory entry, byte for byte.
    factory && (slots[i] === undefined || slots[i]!.kind === 'default')
      ? factory[i]!
      : keyEntry(i, slots[i]),
  );
  const out: Uint8Array[] = [];
  for (let n = 0; n * KEYS_PER_KEYMAP_PACKET < entries.length; n++) {
    const keys = entries.slice(n * KEYS_PER_KEYMAP_PACKET, (n + 1) * KEYS_PER_KEYMAP_PACKET);
    const p = new Uint8Array(REPORT_BYTES);
    p.set([KEYMAP_CMD, layer, 0x00, n, keys.length * 4]);
    p.set(keys.flat(), 5);
    out.push(p);
  }
  return out;
}

/**
 * Sleep (official driver, "[Sleep time]"): output report `01 00 00 00 01 00 …` with the light-off
 * time and the keyboard sleep time in seconds, big-endian, at bytes 13–14 and 15–16. The driver
 * refuses a keyboard sleep under 300 s and a light-off time longer than the keyboard sleep.
 */
export const SLEEP_CMD = 0x01;
export const MIN_SLEEP_SECONDS = 300;
export const SLEEP_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' },
];

export function sleepPacket(lightOffSeconds: number, sleepSeconds: number): Uint8Array {
  const kb = Math.round(sleepSeconds);
  const light = Math.round(lightOffSeconds);
  if (!Number.isInteger(kb) || kb < MIN_SLEEP_SECONDS || kb > 0xffff)
    throw new ProtocolError(`The keyboard sleep time must be ${MIN_SLEEP_SECONDS}–65535 seconds.`);
  if (light < 0 || light > kb)
    throw new ProtocolError('The lighting cannot turn off later than the keyboard sleeps.');
  const p = new Uint8Array(REPORT_BYTES);
  p.set([SLEEP_CMD, 0x00, 0x00, 0x00, 0x01, 0x00]);
  p.set([light >> 8, light & 0xff, kb >> 8, kb & 0xff], 13);
  return p;
}

/** The eight per-key packets (without the report ID). */
export function perKeyPackets(colors: PerKeyRgb): Uint8Array[] {
  const scale = (v: number) => Math.round((clamp(v, 0, 255) * COLOR_MAX) / 255);
  const out: Uint8Array[] = [];
  for (let n = 0; n < PER_KEY_PACKETS; n++) {
    const first = n * LEDS_PER_PACKET;
    const count = Math.min(LEDS_PER_PACKET, LED_COUNT - first);
    const p = new Uint8Array(REPORT_BYTES);
    p.set([PER_KEY_CMD, 0x00, 0x00, n, count * 3]);
    for (let i = 0; i < count; i++) {
      const c = colors[first + i];
      if (c) p.set([scale(c.r), scale(c.g), scale(c.b)], 5 + i * 3);
    }
    out.push(p);
  }
  return out;
}

const isChannel = (c: HidCollection) =>
  c.usagePage === USAGE_PAGE &&
  c.usage === USAGE &&
  c.outputReports.some((r) => r.reportId === REPORT_ID && r.size === REPORT_BYTES);
const channel = (g: { interfaces: HidInterfaceInfo[] }) =>
  g.interfaces.find((i) => i.collections.some(isChannel));
const listedModel = (g: { identity: DeviceIdentity }) =>
  MODELS.find((m) => m.vendorId === g.identity.vendorId && m.productId === g.identity.productId);
/** The source's own detection rule: vendor 0416 with the product string "Gaming Keyboard". */
const sourceRule = (g: { identity: DeviceIdentity }) =>
  g.identity.vendorId === VENDOR_ID && g.identity.productName.trim() === PRODUCT_NAME;

/** The lighting packet, without the report ID. */
export function lightingPacket(c: RgbConfig): Uint8Array {
  const mode = MODES.find((m) => m.id === c.effect);
  if (!mode) throw new ProtocolError(`Effect ${c.effect} is not one of the keyboard’s effects.`);
  const p = new Uint8Array(REPORT_BYTES);
  const c2 = c.color2 ?? c.color;
  p.set(LIGHTING_HEADER);
  p.set(
    [
      mode.id,
      clamp(c.brightness, 0, LEVEL_MAX),
      clamp(c.speed, 0, LEVEL_MAX),
      clamp(c.color.r, 0, 255),
      clamp(c.color.g, 0, 255),
      clamp(c.color.b, 0, 255),
      clamp(c2.r, 0, 255),
      clamp(c2.g, 0, 255),
      clamp(c2.b, 0, 255),
      DIRECTION_CODES[c.direction],
      c.colorful ? 1 : 0,
    ],
    LIGHTING_HEADER.length,
  );
  return p;
}

/**
 * The official driver also has a lighting query (`07 01`, "Inquire [Keyboard Light Config]").
 * OpenKey does not send it: an MK870 owner saw the lights go dark when the app connected while it
 * sent this query, and no capture shows the keyboard answering it.
 */

export const DEFAULT_CONFIG: RgbConfig = {
  effect: 0x00,
  color: { r: 255, g: 0, b: 0 },
  color2: { r: 0, g: 0, b: 255 },
  colorful: false,
  brightness: LEVEL_MAX,
  speed: 2,
  direction: 'up',
};

/**
 * Protocol check, from the official FL Esports driver V1.06.16. Its lighting query (`07 01`) is
 * not offered: an MK870 owner saw the lights go dark when the app connected while it sent it.
 */
export const PROTOCOL_CHECKS: readonly ProtocolCheckInfo[] = [
  {
    id: 'model-query',
    title: 'Model query',
    command: '15',
    source:
      'FL Esports driver V1.06.16: “Inquire [Device SN 0x15]”, which it asks to choose the keyboard’s tables',
    effect: 'read-only',
  },
];
const CHECK_BYTES: Record<string, readonly number[]> = {
  'model-query': [0x15],
};

/**
 * Model codes of the official FL Esports driver V1.06.16 (its `KeyInfo_<code>.config` and
 * `<code>_Def….xml` resources). The driver picks a keyboard's key, Fn-layer and onboard tables by
 * this code; the model query records a code only when it is one of these.
 */
// prettier-ignore
export const DRIVER_MODEL_CODES: ReadonlySet<string> = new Set([
  'COXCKT87RGB', 'CR810BTRGB', 'D87BRGB', 'D87RGB', 'D87SKRGB', 'FK5011URGB', 'FK5222URGB',
  'FK5223URGB', 'FK5224URGB', 'GK5000RGB', 'GK687SRGB', 'GK8110IRRGB', 'GK8110NU01RGB',
  'GK8110RGB', 'GK8110SKRGB', 'GK8120IRNU01RGB', 'GK8120IRRGB', 'GK8120NU01RGB', 'GK8120RGB',
  'GK8120SKRGB', 'GK8150SKRGB', 'GK8170MRGB', 'GM518RGB', 'GM810RGB', 'GM810UKRGB', 'HDSC61RGB',
  'K171RGB', 'K171UKRGB', 'K180CVRGB', 'K180ZETRGB', 'K181ZETRGB', 'K188BRGB', 'K188RGB',
  'K191CVRGB', 'K191DPLRGB', 'K191UKDPLRGB', 'K191ZETRGB', 'K198UKRGB', 'K202BRGB', 'K202DRGB',
  'K202ERGB', 'K202MechaRGB', 'K202RGB', 'K204RGB', 'K205RGB', 'K205UKRGB', 'K210RGB',
  'K210ZETRGB', 'K212BRGB', 'K212DPLRGB', 'K215RGB', 'K216RGB', 'K217BTRGB', 'K217RGB',
  'K220RGB', 'K221CVRGB', 'K221IRCVJPRGB', 'K221IRCVRGB', 'K221IRCVUKRGB', 'K221JPCVRGB',
  'K221UKCVRGB', 'K223BILIRGB', 'K223BRGB', 'K223RGB', 'K224BRGB', 'K224BTRGB', 'K224RGB',
  'K225CVRGB', 'K225JPCVRGB', 'K225UKCVRGB', 'K228BILIRGB', 'K228IRRGB', 'K228RGB',
  'K232SKAG75RGB', 'K232SKRGB', 'K235RGB', 'K237BTRGB', 'K237RGB', 'K242BTRGB', 'K245RGB',
  'K247BTRGB', 'K24RGB', 'K30RGB', 'K660CVRGB', 'K660ZETRGB', 'K662RGB', 'K665MRGB', 'K665RGB',
  'K665UKIRIBARGB', 'K668RGB', 'K75RGB', 'K87RGB', 'K980CBZRGB', 'KC104RGB', 'KC104RRGB',
  'KC104RZETRGB', 'KC104SKRGB', 'KC21BTRGB', 'KC66RGB', 'KC68RGB', 'KC84RGB', 'KD1IR_MRGB',
  'KD3IR_MRGB', 'KG045BTRGB', 'KM87RGB', 'KR046BTRGB', 'KR081BTRGB', 'LP87ZETRGB', 'M87RGB',
  'MK061X', 'MK061XRGB', 'MK104RGB', 'MK1061RGB', 'MK3108ASKRGB', 'MK3108SKRGB', 'MK6SKRGB',
  'MK87RGB', 'Mek5', 'Mixabl84RGB', 'NK60RGB', 'NK60TRGB', 'NP87UKDrevoRGB', 'NP87ZETRGB',
  'RTK61RGB', 'RTK68RGB', 'SD84RGB', 'SN87RGB', 'ST98RGB', 'TF84RGB', 'TK61BIRRGB', 'TK61IRRGB',
  'TY61MiniRGB', 'TY69SKRGB', 'TY84DREVORGB', 'TY84HKRGB', 'TY84RGB', 'TYNYF84RGB', 'TYSW68RGB',
  'VET61IRRGB', 'VS61RGB', 'VS84RGB', 'VS87RGB', 'VX9PRORGB', 'XS61BRGB', 'XS61CRGB',
  'XS61FANRGB', 'XS61RGB', 'XS61_SNRGB', 'XS62RGB', 'XS62SKRGB', 'XS63RGB', 'XS63_SNRGB',
  'XS84RGB', 'XS87RGB', 'Y75BBTRGB', 'Y75BTRGB', 'Y84BTRGB', 'ZK104UKDrevoRGB', 'ZK87DrevoRGB',
]);

/** The driver model code an answer names, if it names one of `DRIVER_MODEL_CODES`. */
export function modelCodeIn(reply: Uint8Array): string | undefined {
  const text = Array.from(reply, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ' '));
  for (const token of text.join('').split(/[^A-Za-z0-9_]+/))
    if (DRIVER_MODEL_CODES.has(token)) return token;
  return undefined;
}
const CHECK_TIMEOUT_MS = 500;
/** Longest wait for the keyboard's echo of a key-map packet. */
const KEYMAP_ACK_MS = 150;

export class WinbondDriver extends BaseKeyboardDriver implements DiagnosticsDriver {
  readonly protocolId = WINBOND_PROTOCOL_ID;
  readonly transport: TransportMode;
  private t: HidTransport | null = null;
  private readonly layout: KeyboardLayout;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    readonly model: string,
    private readonly modes: typeof MODES,
    private readonly opts: {
      store: StateStore;
      open: (i: HidInterfaceInfo) => Promise<HidTransport>;
      /** Features an owner confirmed on this model (`WinbondModel.verified`). */
      verified?: WinbondModel['verified'];
    },
  ) {
    super();
    this.transport = group.transportHint;
    this.layout = ansiLayout({
      id: 'winbond-tkl',
      name: `${model} (ANSI TKL)`,
      size: 'tkl',
      rightMods: 'fn',
      light: (n) => LED_INDEX[n] ?? null,
      // The Fn key is kept as it is: remapping it would lock the user out of the Fn layer.
      slot: (n) => (n === 'Fn' ? -1 : (LED_INDEX[n] ?? -1)),
      source:
        'Standard ANSI TKL geometry; LED indices from the Winbond 6 × 22 LED grid (DanielGibson’s Pulsar PCMK TKL notes, facts only).',
    });
  }

  private get key(): string {
    const id = this.group.identity;
    return `winbond/${id.productId.toString(16)}`;
  }

  async connect(): Promise<void> {
    // Nothing is sent on connection. An MK870 owner saw the lighting go dark when the app
    // connected while it asked for the lighting (07 01) and the model (15); the official driver's
    // captures never show either request, so OpenKey asks neither by itself.
    this.t = await this.opts.open(this.iface);
  }

  /** Driver model code the keyboard reported in the model check (only codes the driver lists). */
  private driverModel: string | undefined;

  private get fnTables() {
    return this.driverModel ? FN_FACTORY_TABLES.get(this.driverModel) : undefined;
  }

  /** Why Fn layers are not written on this keyboard, in words for the user. */
  private get fnBlockedReason(): string {
    const model = this.driverModel
      ? ` It reports model ${this.driverModel}, whose table still needs confirming.`
      : ' It has not reported its model (Device Lab → Report → Run all checks).';
    return `This keyboard’s third (“FN”) layer is written only with its confirmed factory table, because writing it replaces every key on it.${model} To help: Device Lab → Report → Run all checks, and send the package (tester guide).`;
  }

  /** Waits up to `KEYMAP_ACK_MS` for an answer that repeats `command`; true when one came. */
  private async waitForEcho(command: number, ms = KEYMAP_ACK_MS): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (this.t && Date.now() < deadline) {
      const r = await this.t.readInputReport(Math.max(1, deadline - Date.now()));
      if (!r) return false;
      if (r[0] === command) return true;
    }
    return false;
  }

  async disconnect(): Promise<void> {
    const t = this.t;
    this.t = null;
    await t?.close().catch(() => undefined);
  }

  getLayout(): KeyboardLayout {
    return this.layout;
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const verified = new Set(this.opts.verified ?? []);
    const owner = 'MK870 owner test, OpenKey issue #13 (2026-10-24)';
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.OBSERVED,
      source: 'USB identity and product string',
    });
    const level = (f: 'rgb' | 'perKeyRgb' | 'keymap' | 'macros', otherwise: Evidence) =>
      verified.has(f) ? Evidence.VERIFIED : otherwise;
    const cite = (f: 'rgb' | 'perKeyRgb' | 'keymap' | 'macros', source: string) =>
      verified.has(f) ? `${owner}; ${source}` : source;
    c.rgb = configurable('mirror', true, level('rgb', Evidence.OBSERVED), {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: cite(
        'rgb',
        '45 USB captures from an MK870 owner (OpenKey issue #13): every effect, direction, colour, brightness and speed, byte for byte the packet OpenKey sends',
      ),
      value: `${this.modes.length - 1} effects, two colours, rainbow, brightness and speed 0–${LEVEL_MAX}, eight directions`,
      note: 'The keyboard cannot report its lighting, so OpenKey shows what it last wrote. Changes made with the Fn shortcuts are not shown here.',
    });
    c.perKeyRgb = configurable('mirror', true, level('perKeyRgb', Evidence.INFERRED), {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: cite(
        'perKeyRgb',
        'DanielGibson’s Pulsar PCMK TKL notes (0416:B23C, same command family): command 09, 132-LED grid',
      ),
      value: `${this.layout.keys.filter((k) => k.light !== null).length} keys`,
      note: verified.has('perKeyRgb')
        ? 'LED order from the official driver’s matrix. The keyboard cannot report its colours; OpenKey shows what it last wrote.'
        : 'LED order from the official driver’s matrix, confirmed LED by LED on a sibling board (Pulsar PCMK). The keyboard cannot report its colours.',
    });
    c.keymap = configurable('mirror', true, level('keymap', Evidence.INFERRED), {
      safety: SafetyLevel.CAUTION,
      source: cite(
        'keymap',
        'Official FL Esports driver V1.06.16: key-map packet 18 and its default QWERTY profile, decoded from the driver',
      ),
      value:
        'default layer: keys, keys with up to two modifiers, nine media keys, macros, disabled, factory default',
      note: 'The keyboard cannot report its key map; OpenKey shows what it last wrote. The Fn key stays fixed. Restore the defaults to undo.',
    });
    // FN1 is the keyboard's second full layout (owner's manual: hold Fn+Tab for 3 s to switch);
    // the Fn shortcuts are built into the firmware, not stored in this layer. The official driver
    // writes "Default & FN1" (packet 18, layers 0 and 1) on two-layer boards.
    c.fnLayer = configurable('mirror', true, Evidence.INFERRED, {
      safety: SafetyLevel.CAUTION,
      source:
        'MK870 manual (Fn+Tab, hold 3 s: FN1 layer; Fn+Esc, hold 3 s: factory defaults) and the official FL Esports driver (key-map packet 18, layer 1)',
      value: 'FN1 layer: keys, combinations, media keys, macros, disabled',
      note: 'FN1 is the keyboard’s second layout: hold Fn+Tab for 3 seconds to switch to it and back. The Fn shortcuts (volume, lighting …) are built into the keyboard and stay as they are. Undo: Restore layer defaults, or hold Fn+Esc for 3 seconds for factory defaults.',
    });
    c.profiles = feature(FeatureStatus.FIRMWARE_LIMITED, {
      confidence: Evidence.INFERRED,
      source: 'MK870 manual: the default layer and the FN1 layer, switched with Fn+Tab',
      value: 'Two layouts on the keyboard: default and FN1 (hold Fn+Tab for 3 s to switch)',
      note: 'Edit both layouts on the Keymap page. OpenKey profiles (Profiles page) also save and restore the lighting, key map, macros and sleep time from this browser.',
      blockedReason:
        'The MK870 keeps two layouts on the keyboard: the default layer and FN1. Edit both on the Keymap page and switch between them on the keyboard (hold Fn+Tab for 3 seconds). Switching from the computer is not part of the documented protocol, so OpenKey does not send it.',
    });
    c.sleep = configurable('mirror', true, Evidence.INFERRED, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: 'Official FL Esports driver V1.06.16: “[Sleep time]” packet, decoded from the driver',
      value: 'Lights off and keyboard asleep after 5 min to 1 h without typing',
      note: 'The official FL Esports app has the same setting. After this much time without a key press the keyboard turns its lights off and sleeps; any key press wakes it. The keyboard cannot report it; OpenKey shows what it last wrote.',
    });
    c.factoryDefaults = configurable('none', true, Evidence.INFERRED, {
      safety: SafetyLevel.CAUTION,
      source: 'Official FL Esports driver V1.06.16: default QWERTY profile',
      note: 'Restores the key map by writing the driver’s default table; the lighting and sleep stay as they are.',
    });
    c.macros = configurable('mirror', true, level('macros', Evidence.INFERRED), {
      safety: SafetyLevel.CAUTION,
      source: cite(
        'macros',
        'Official FL Esports driver V1.06.16: macro uploader (command 19), decoded from the driver',
      ),
      value: `${MACRO_SLOTS} macros of up to ${MACRO_MAX_EVENTS} presses and releases; play once, several times, toggle or while held`,
      note: 'Stored on the keyboard: a macro plays once it is assigned to a key in the key map. The keyboard cannot report its macros; OpenKey shows what it last wrote.',
    });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      model: this.model,
      profileId: this.key.replace('/', '-'),
      identity: this.group.identity,
      firmware: {
        version: null,
        source: 'not reported by this protocol',
        confidence: Evidence.UNKNOWN,
      },
      transport: this.transport,
      protocol: {
        id: this.protocolId,
        name: 'Winbond OEM keyboard protocol (FF1B output report 1)',
      },
      battery: null,
      fields: this.driverModel
        ? [
            {
              key: 'driverModel',
              label: 'Driver model',
              value: this.driverModel,
              confidence: Evidence.OBSERVED,
              source:
                'Reported by the keyboard in the model check (query 15 of the official driver)',
            },
          ]
        : [],
    };
  }

  override getRgbEffects(): EffectCatalog {
    return {
      effects: this.modes.map((m) => ({
        id: m.id,
        name: m.name,
        controls: {
          color: m.id !== CUSTOM_EFFECT,
          color2: m.id !== CUSTOM_EFFECT,
          colorful: m.id !== CUSTOM_EFFECT,
          brightness: true,
          speed: m.speed,
          direction: m.dirs,
        },
      })),
      brightness: { min: 0, max: LEVEL_MAX },
      speed: { min: 0, max: LEVEL_MAX },
      customEffect: CUSTOM_EFFECT,
    };
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    return (await this.opts.store.get<RgbConfig>(this.key)) ?? DEFAULT_CONFIG;
  }

  override async setRgbConfig(c: RgbConfig): Promise<void> {
    if (!this.t) throw new ProtocolError('Not connected');
    const mode = this.modes.find((m) => m.id === c.effect);
    if (!mode) throw new ProtocolError(`Effect ${c.effect} is not offered on this keyboard.`);
    // An effect without that direction keeps the first one it offers, as the source's app does.
    const direction =
      mode && mode.dirs.length && !mode.dirs.includes(c.direction) ? mode.dirs[0]! : c.direction;
    const config = { ...c, direction };
    this.t.drainInput();
    await this.t.sendOutputReport(REPORT_ID, lightingPacket(config));
    await this.opts.store.set(this.key, config);
  }

  readonly testGuide = 'docs/FL_ESPORTS_MK870.md';

  listProtocolChecks(): readonly ProtocolCheckInfo[] {
    return PROTOCOL_CHECKS;
  }

  /** Sends one read-only request and keeps only the shape of the answer (see core diagnostics). */
  async runProtocolCheck(id: string): Promise<ProtocolCheckResult> {
    const info = PROTOCOL_CHECKS.find((c) => c.id === id);
    const bytes = CHECK_BYTES[id];
    if (!info || !bytes) throw new ProtocolError(`Unknown protocol check “${id}”.`);
    if (!this.t) throw new ProtocolError('Not connected');
    const base = { id, title: info.title, command: info.command, source: info.source };
    const at = new Date().toISOString();
    const p = new Uint8Array(REPORT_BYTES);
    p.set(bytes);
    try {
      this.t.drainInput();
      await this.t.sendOutputReport(REPORT_ID, p);
      const r = await this.t.readInputReport(CHECK_TIMEOUT_MS);
      if (!r)
        return {
          ...base,
          at,
          status: 'no-answer',
          detail: `No input report within ${CHECK_TIMEOUT_MS} ms.`,
        };
      const reply = replyShape(REPORT_ID, r, bytes[0]!);
      const model = id === 'model-query' && reply.echo ? modelCodeIn(r) : undefined;
      if (model) this.driverModel = model;
      return {
        ...base,
        at,
        status: reply.echo ? 'answered' : 'unexpected',
        reply,
        ...(model ? { facts: { driverModel: model } } : {}),
        detail: !reply.echo
          ? 'The keyboard sent an input report that does not repeat the command.'
          : id !== 'model-query'
            ? 'The keyboard answered on the vendor channel, repeating the command.'
            : model
              ? `The keyboard reported the driver model ${model}.`
              : 'The keyboard answered, but with no model code from the driver’s list; nothing from the answer is kept.',
      };
    } catch (e) {
      return {
        ...base,
        at,
        status: 'error',
        detail: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
      };
    }
  }

  override getKeyActionKinds(): readonly KeyActionKind[] {
    return ['default', 'disabled', 'keyboard', 'special', 'macro'];
  }

  override getMacroLimits(): MacroLimits {
    return MACRO_LIMITS;
  }

  override async getMacros(): Promise<Macro[]> {
    return (await this.opts.store.get<Macro[]>(`${this.key}/macros`)) ?? [];
  }

  /** Stores the macros, and writes the slots the current key map uses (others are cleared). */
  override async setMacros(macros: Macro[]): Promise<void> {
    for (const m of macros)
      if (m.index < 0 || m.index >= MACRO_SLOTS)
        throw new ProtocolError(
          `Macro ${m.index + 1} is outside the keyboard’s ${MACRO_SLOTS} slots.`,
        );
    // Encode everything first: nothing is sent if one macro does not fit.
    const records = this.macroRecords(macros, await this.layerBindings());
    await this.writeMacroSlots(records);
    await this.opts.store.set(`${this.key}/macros`, macros);
  }

  /** How each slot is played, from the keys bound to it; two keys must agree. */
  private macroPlays(layers: Record<number, KeyAction>[]): Map<number, MacroPlay> {
    const plays = new Map<number, MacroPlay>();
    for (const a of layers.flatMap((slots) => Object.values(slots))) {
      if (a.kind !== 'macro') continue;
      const play = { mode: a.mode, repeat: a.mode === 'repeat' ? a.repeat : 1 };
      const had = plays.get(a.index);
      if (had && (had.mode !== play.mode || had.repeat !== play.repeat))
        throw new ProtocolError(
          `Macro ${a.index + 1} is used by two keys with different play modes; this keyboard stores one mode per macro.`,
        );
      plays.set(a.index, play);
    }
    return plays;
  }

  private macroRecords(macros: Macro[], layers: Record<number, KeyAction>[]): Uint8Array[] {
    const plays = this.macroPlays(layers);
    return Array.from({ length: MACRO_SLOTS }, (_, i) => {
      const play = plays.get(i);
      return play
        ? macroRecord(
            macros.find((m) => m.index === i),
            play,
          )
        : macroRecord(undefined, { mode: 'once', repeat: 1 });
    });
  }

  /** Sends every slot, each packet acknowledged by a `19` echo (resent up to four times). */
  private async writeMacroSlots(records: Uint8Array[]): Promise<void> {
    if (!this.t) throw new ProtocolError('Not connected');
    this.t.drainInput();
    for (const [slot, record] of records.entries())
      for (const p of macroPackets(slot, record)) {
        let acked = false;
        for (let attempt = 0; attempt < MACRO_RETRIES && !acked; attempt++) {
          await this.t.sendOutputReport(REPORT_ID, p);
          acked = await this.waitForEcho(MACRO_CMD, MACRO_ACK_MS);
        }
        if (!acked)
          throw new ProtocolError(
            `The keyboard did not confirm macro slot ${slot + 1}; nothing more was sent.`,
          );
      }
  }

  override getSpecialActions(): readonly { code: number; label: string }[] {
    return MEDIA_KEYS;
  }

  override getSettingsSchema(): SettingsSchema {
    return { sleepTime: [...SLEEP_OPTIONS] };
  }

  override async getSystemSettings(): Promise<SystemSettings> {
    return (await this.opts.store.get<SystemSettings>(`${this.key}/settings`)) ?? {};
  }

  /** Sleep time in seconds (`SLEEP_OPTIONS` values); the lighting turns off at the same time. */
  override async setSystemSettings(settings: SystemSettings): Promise<void> {
    if (!this.t) throw new ProtocolError('Not connected');
    const merged = { ...(await this.getSystemSettings()), ...settings };
    if (merged.sleepTime === undefined) return;
    const packet = sleepPacket(merged.sleepTime, merged.sleepTime);
    this.t.drainInput();
    await this.t.sendOutputReport(REPORT_ID, packet);
    await this.opts.store.set(`${this.key}/settings`, { sleepTime: merged.sleepTime });
  }

  override getLayerLabel(layer: LayerId): string | undefined {
    return layer === 'fn' ? 'FN1 layer (Fn+Tab)' : layer === 'layer2' ? 'FN layer' : undefined;
  }

  override getLayerIds(): readonly LayerId[] {
    return this.fnTables?.fn2 ? ['base', 'fn', 'layer2'] : ['base', 'fn'];
  }

  override async getKeymap(layer: LayerId = 'base'): Promise<KeymapState> {
    if (layer !== 'base' && layer !== 'fn' && layer !== 'layer2') return super.getKeymap(layer);
    const saved = await this.opts.store.get<KeymapState>(this.keymapKey(layer));
    return saved ?? { layer, slots: {}, provenance: 'assumed-default' };
  }

  override async setKeymap(state: KeymapState): Promise<void> {
    if (!this.t) throw new ProtocolError('Not connected');
    const layer =
      state.layer === 'base' ? 0 : state.layer === 'fn' ? 1 : state.layer === 'layer2' ? 2 : -1;
    if (layer < 0) throw new ProtocolError(`Layer ${state.layer} does not exist on this keyboard.`);
    // Layers 0 and 1 start from the official default table; a third ("FN") layer exists only on
    // three-layer models and is written only with its confirmed factory table.
    const factory = layer === 1 ? this.fnTables?.fn1 : layer === 2 ? this.fnTables?.fn2 : undefined;
    if (layer === 2 && !factory) throw new SafetyBlockedError(this.fnBlockedReason);
    const packets = keymapPackets(layer, state.slots, factory);
    // Macros used by either layer are written first (as the official driver does), so no key
    // points at a slot that is not there yet; slots no layer uses any more are cleared.
    const before = await this.layerBindings();
    const after = await this.layerBindings(state.layer, state.slots);
    const records = this.macroRecords(await this.getMacros(), after);
    const anyMacro = (list: Record<number, KeyAction>[]) =>
      list.some((slots) => Object.values(slots).some((a) => a.kind === 'macro'));
    if (anyMacro(before) || anyMacro(after)) await this.writeMacroSlots(records);
    this.t.drainInput();
    // The keyboard answers each key-map packet with an `18` echo (handled by the official driver);
    // waiting briefly for it paces the writes to the keyboard's memory. An echo is not a read-back.
    for (const p of packets) {
      await this.t.sendOutputReport(REPORT_ID, p);
      await this.waitForEcho(KEYMAP_CMD);
    }
    await this.opts.store.set(this.keymapKey(state.layer), {
      layer: state.layer,
      slots: state.slots,
      provenance: 'mirror',
      updatedAt: new Date().toISOString(),
    } satisfies KeymapState);
  }

  private keymapKey(layer: LayerId): string {
    return layer === 'base' ? `${this.key}/keymap` : `${this.key}/keymap-${layer}`;
  }

  /** Key maps of both written layers, with `layer` replaced by `slots` when given. */
  private async layerBindings(
    layer?: LayerId,
    slots?: Record<number, KeyAction>,
  ): Promise<Record<number, KeyAction>[]> {
    const of = async (id: LayerId) =>
      id === layer && slots ? slots : (await this.getKeymap(id)).slots;
    return [await of('base'), await of('fn')];
  }

  /** Writes the official default table back to the base or FN1 layer. */
  override async restoreDefaults(
    scope: 'keymap' | 'fnLayer' | 'macros' | 'lighting',
  ): Promise<void> {
    if (scope === 'keymap')
      return this.setKeymap({ layer: 'base', slots: {}, provenance: 'mirror' });
    if (scope === 'fnLayer')
      return this.setKeymap({ layer: 'fn', slots: {}, provenance: 'mirror' });
    return super.restoreDefaults(scope);
  }

  override async getPerKeyRgb(): Promise<PerKeyRgb> {
    return (await this.opts.store.get<PerKeyRgb>(`${this.key}/per-key`)) ?? {};
  }

  /** The eight colour packets, then the custom effect that shows them (as the vendor software does). */
  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    if (!this.t) throw new ProtocolError('Not connected');
    this.t.drainInput();
    for (const p of perKeyPackets(colors)) await this.t.sendOutputReport(REPORT_ID, p);
    const current = await this.getRgbConfig();
    await this.setRgbConfig({ ...current, effect: CUSTOM_EFFECT, colorful: true });
    await this.opts.store.set(`${this.key}/per-key`, colors);
  }
}

export const winbondProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: WINBOND_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb'], configuration: ['usb'] },
    verification:
      'MK870 (0416:C345): lighting, per-key colours, base-layer key map and macros verified by an owner from OpenKey (issue #13); lighting packets match 45 captures of the official app byte for byte. FN1 layer and sleep decoded from the official FL Esports driver, not yet owner-tested.',
    safety:
      'Nothing is sent while detecting: the keyboard is identified from its USB identity, product string and exact report layout. Nothing is sent on connection. Only the lighting, per-key, key-map, macro and sleep packets of the official driver are sent; features not yet owner-tested stay behind the experimental opt-in. The read-only model query runs only when the user starts a protocol check. The firmware-update (0B), serial-number (16) and LCD-firmware (22) commands are never sent.',
    provenance: [
      {
        source: 'public-reverse-engineering',
        reference:
          'Mqlvin/keyboard-colour src/usb.rs, src/app.rs (MIT): lighting packet, modes, directions',
        status: Evidence.INFERRED,
      },
      {
        source: 'public-reverse-engineering',
        reference:
          'gist DanielGibson/cd92c5faa6b2e0426351dc44193c6182 (Pulsar PCMK TKL, 0416:B23C; facts only): per-key command 09, LED grid, custom effect 0x0A, colour range',
        status: Evidence.INFERRED,
      },
      {
        source: 'official-driver',
        reference:
          'FL Esports driver V1.06.16 (fl-esports.com): supported-device list (0416:B23C NUC121, 0416:C345 M252), default profile (6 × 22 matrix), command table and key-map packet 18 decoded from the driver',
        status: Evidence.OBSERVED,
      },
      {
        source: 'descriptor',
        reference:
          'MK870 0416:C345 support bundle: FF1B:0091 with input and output report 1 (63 B)',
        status: Evidence.OBSERVED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Verified by an MK870 owner: lighting (every effect), per-key colours, base-layer key map and all 10 macro slots. The FN1 layer and sleep time are not yet owner-tested; on the Pulsar PCMK only lighting and per-key are tested (by DanielGibson).',
      'The lighting, key map, per-key colours, macros and sleep time cannot be read from the keyboard; OpenKey shows what it last wrote.',
      'Key map: the default and FN1 layers (keys, two-modifier combinations, nine media keys, macros); the Fn shortcuts are built into the firmware and are not changed. A third “FN” layer (three-layer models) is written only with its confirmed factory table.',
      'Onboard layouts are switched on the keyboard (Fn+Tab, hold 3 s); OpenKey does not switch them from the computer.',
      'Macros: 10 slots of up to 62 presses and releases; the byte before the slot in a macro key’s entry is the 1 every key carries in the driver’s profiles (confirmed only for play once).',
      'Music response follows audio the vendor app streams (command 20); OpenKey does not stream audio.',
    ],
    fixtures: ['fixtures/rgb/mk870-lighting-captures-issue13.json', MK870_OWNER_TEST],
    verifiedIdentities: [
      {
        vendorId: VENDOR_ID,
        productId: 0xc345,
        productName: PRODUCT_NAME,
        transport: 'usb',
        scope: 'lighting (every effect), per-key colours, base-layer key map, 10 macro slots',
        evidence: MK870_OWNER_TEST,
      },
    ],
  },
  name: 'Winbond OEM keyboard protocol (FL Esports MK870, Pulsar PCMK …)',
  family: WINBOND_PROTOCOL_ID,
  priority: 42,
  supportedDevices:
    'FL Esports MK870 (0416:C345), Pulsar PCMK TKL / KT108 (0416:B23C); other 0416 "Gaming Keyboard" boards on request',
  supportedFirmware: 'Winbond keyboard firmware with the FF1B:0091 channel',
  requiredUsagePages: [USAGE_PAGE],
  requiredReports: ['FF1B output id 1 63B'],
  evidence: ['Mqlvin/keyboard-colour (MIT)'],
  probePlan: {
    operations: [],
    autoConsent: (g) =>
      listedModel(g)
        ? {
            auto: true,
            reason: 'no packet is sent: the model is identified from its USB identity',
          }
        : {
            auto: false,
            reason:
              'not a confirmed model; matches the source’s own rule (0416, "Gaming Keyboard")',
          },
    identifiedBy: 'vendor-model-list',
  },
  match(group): CandidateMatch {
    if (!channel(group))
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['no FF1B:0091 output report 1 of 63 bytes'],
      };
    const model = listedModel(group);
    if (model)
      return {
        applicable: true,
        score: 60,
        reasons: ['FF1B:0091 output report 1 (63 B)', `${model.model} (0416:C345)`],
        rejections: [],
      };
    if (sourceRule(group))
      return {
        applicable: true,
        score: 40,
        reasons: ['FF1B:0091 output report 1 (63 B)', 'Winbond 0416 "Gaming Keyboard"'],
        rejections: [],
      };
    return {
      applicable: false,
      score: 0,
      reasons: [],
      rejections: ['not a Winbond "Gaming Keyboard"'],
    };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const model = listedModel(ctx.group);
    const ok = !!channel(ctx.group) && (!!model || sourceRule(ctx.group));
    const name = model?.model ?? 'Winbond gaming keyboard';
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.INFERRED : Evidence.HYPOTHESIS,
      summary: ok
        ? `${name}: identified from its USB identity and report layout (this protocol has no read command)`
        : 'Not a Winbond gaming keyboard',
      steps: [
        { name: 'model list', status: ok ? 'pass' : 'fail', detail: ok ? name : 'not listed' },
      ],
      facts: ok ? { model: name } : {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const ch = channel(group);
    const model = listedModel(group);
    if (!ch || (!model && !sourceRule(group))) throw new Error('Not a Winbond gaming keyboard');
    const modes = model?.effects ? MODES.filter((m) => model.effects!.includes(m.id)) : MODES;
    return new WinbondDriver(group, ch, model?.model ?? 'Winbond gaming keyboard', modes, {
      store: opts.store,
      open: async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
      verified: model?.verified,
    });
  },
};

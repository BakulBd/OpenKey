import {
  BaseKeyboardDriver,
  Evidence,
  FeatureStatus,
  ProtocolError,
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
}

export const MODELS: readonly WinbondModel[] = [
  { vendorId: VENDOR_ID, productId: 0xc345, model: 'FL Esports MK870' },
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
 * Effects with the source's names, code, speed and directions. "Musical rhythm" (0x64) is left out:
 * it follows audio the vendor software streams, which OpenKey does not send.
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

/** The ten key-map packets of one layer (without the report ID). */
export function keymapPackets(layer: number, slots: Record<number, KeyAction>): Uint8Array[] {
  const entries = DEFAULT_KEYS.map((_, i) => keyEntry(i, slots[i]));
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
 * Lighting query (official driver, "Inquire [Keyboard Light Config]"): `07 01`. The driver's parser
 * reads the answer at the positions of the lighting write: after the `07` echo, mode at payload
 * byte 5, brightness 6, speed 7, colour 8–10, second colour 11–13, direction 14, rainbow 15.
 */
export const LIGHTING_QUERY = [0x07, 0x01] as const;

const DIRECTION_BY_CODE = new Map(
  Object.entries(DIRECTION_CODES).map(([d, c]) => [c, d as Direction]),
);

/** Parses a lighting answer (payload without the report ID); null when it is not one. */
export function parseLightingReply(r: Uint8Array): RgbConfig | null {
  if (r.length < 16 || r[0] !== LIGHTING_QUERY[0]) return null;
  return {
    effect: r[5]!,
    brightness: Math.min(r[6]!, LEVEL_MAX),
    speed: Math.min(r[7]!, LEVEL_MAX),
    color: { r: r[8]!, g: r[9]!, b: r[10]! },
    color2: { r: r[11]!, g: r[12]!, b: r[13]! },
    direction: DIRECTION_BY_CODE.get(r[14]!) ?? 'up',
    colorful: r[15] === 1,
  };
}

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
 * Read-only protocol checks, from the official FL Esports driver V1.06.16: `07 01` is its
 * "Inquire [Keyboard Light Config]" request (the lighting write is `07 00 …`).
 */
export const PROTOCOL_CHECKS: readonly ProtocolCheckInfo[] = [
  {
    id: 'lighting-query',
    title: 'Lighting query',
    command: '07 01',
    source: 'FL Esports driver V1.06.16: “Inquire [Keyboard Light Config]”',
    effect: 'read-only',
  },
];
const CHECK_BYTES: Record<string, readonly number[]> = { 'lighting-query': [0x07, 0x01] };
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

  /** Set on connection when the keyboard answered the lighting query. */
  private lightingReadable = false;

  async connect(): Promise<void> {
    this.t = await this.opts.open(this.iface);
    // The official driver asks for the lighting when it connects; OpenKey reads it back from the
    // keyboard only if this keyboard answers, and otherwise keeps its own record.
    this.lightingReadable = (await this.queryLighting().catch(() => null)) !== null;
  }

  /** Waits up to `KEYMAP_ACK_MS` for an answer that repeats `command`; true when one came. */
  private async waitForEcho(command: number): Promise<boolean> {
    const deadline = Date.now() + KEYMAP_ACK_MS;
    while (this.t && Date.now() < deadline) {
      const r = await this.t.readInputReport(Math.max(1, deadline - Date.now()));
      if (!r) return false;
      if (r[0] === command) return true;
    }
    return false;
  }

  private async queryLighting(): Promise<RgbConfig | null> {
    if (!this.t) throw new ProtocolError('Not connected');
    const q = new Uint8Array(REPORT_BYTES);
    q.set(LIGHTING_QUERY);
    this.t.drainInput();
    await this.t.sendOutputReport(REPORT_ID, q);
    for (let i = 0; i < 3; i++) {
      const r = await this.t.readInputReport(CHECK_TIMEOUT_MS);
      if (!r) return null;
      const parsed = parseLightingReply(r);
      if (parsed) return parsed;
    }
    return null;
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
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.OBSERVED,
      source: 'USB identity and product string',
    });
    c.rgb = configurable(this.lightingReadable ? 'device' : 'mirror', true, Evidence.INFERRED, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source:
        'Mqlvin/keyboard-colour (MIT), captured from the vendor software, which an MK870 owner ran on 0416:C345; lighting query and its answer layout from the official FL Esports driver',
      value: `${this.modes.length - 1} effects, two colours, rainbow, brightness and speed 0–${LEVEL_MAX}, eight directions`,
      note: this.lightingReadable
        ? 'Read from the keyboard and read back after each change.'
        : 'This keyboard did not answer the lighting query, so OpenKey shows what it last wrote.',
    });
    c.perKeyRgb = configurable('mirror', true, Evidence.INFERRED, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source:
        'DanielGibson’s Pulsar PCMK TKL notes (0416:B23C, same command family): command 09, 132-LED grid',
      value: `${this.layout.keys.filter((k) => k.light !== null).length} keys`,
      note: 'LED order from the official driver’s matrix, confirmed LED by LED on a sibling board (Pulsar PCMK). The keyboard cannot report its colours.',
    });
    c.keymap = configurable('mirror', true, Evidence.INFERRED, {
      safety: SafetyLevel.CAUTION,
      source:
        'Official FL Esports driver V1.06.16: key-map packet 18 and its default QWERTY profile, decoded from the driver',
      value:
        'default layer: keys, keys with up to two modifiers, nine media keys, disabled, factory default',
      note: 'The keyboard cannot report its key map; OpenKey shows what it last wrote. The Fn key stays fixed. Restore the defaults to undo.',
    });
    c.fnLayer = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
      confidence: Evidence.INFERRED,
      note: 'The FN1 and FN layers use the same packet, but their factory contents are not in the driver files; writing them would erase the Fn functions.',
    });
    c.sleep = configurable('mirror', true, Evidence.INFERRED, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: 'Official FL Esports driver V1.06.16: “[Sleep time]” packet, decoded from the driver',
      note: 'The keyboard cannot report it; OpenKey shows what it last wrote. The lighting turns off when the keyboard sleeps.',
    });
    c.factoryDefaults = configurable('none', true, Evidence.INFERRED, {
      safety: SafetyLevel.CAUTION,
      source: 'Official FL Esports driver V1.06.16: default QWERTY profile',
      note: 'Restores the key map by writing the driver’s default table; the lighting and sleep stay as they are.',
    });
    c.macros = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
      confidence: Evidence.INFERRED,
      note: 'In the official driver the keyboard does not store macro contents: its onboard macro list (command 19) is sent empty, and macros are played by the vendor app through key reports (commands 04 and 05). A web page cannot keep running in the background to play them.',
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
      fields: [],
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
    if (this.lightingReadable) {
      const live = await this.queryLighting();
      if (!live) throw new ProtocolError('The keyboard did not answer the lighting query.');
      return live;
    }
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
      return {
        ...base,
        at,
        status: reply.echo ? 'answered' : 'unexpected',
        reply,
        detail: reply.echo
          ? 'The keyboard answered on the vendor channel, repeating the command.'
          : 'The keyboard sent an input report that does not repeat the command.',
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
    return ['default', 'disabled', 'keyboard', 'special'];
  }

  override getSpecialActions(): readonly { code: number; label: string }[] {
    return MEDIA_KEYS;
  }

  /** The key map goes back to the driver's own default table (nothing else is reset). */
  override async restoreDefaults(
    scope: 'keymap' | 'fnLayer' | 'macros' | 'lighting',
  ): Promise<void> {
    if (scope !== 'keymap') return super.restoreDefaults(scope);
    await this.setKeymap({ layer: 'base', slots: {}, provenance: 'mirror' });
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

  override getLayerIds(): readonly LayerId[] {
    return ['base'];
  }

  override async getKeymap(layer: LayerId = 'base'): Promise<KeymapState> {
    if (layer !== 'base') return super.getKeymap(layer);
    const saved = await this.opts.store.get<KeymapState>(`${this.key}/keymap`);
    return saved ?? { layer: 'base', slots: {}, provenance: 'assumed-default' };
  }

  override async setKeymap(state: KeymapState): Promise<void> {
    if (!this.t) throw new ProtocolError('Not connected');
    if (state.layer !== 'base')
      throw new ProtocolError('Only the default layer can be written on this keyboard.');
    const packets = keymapPackets(0, state.slots);
    this.t.drainInput();
    // The keyboard answers each key-map packet with an `18` echo (handled by the official driver);
    // waiting briefly for it paces the writes to the keyboard's memory. An echo is not a read-back.
    for (const p of packets) {
      await this.t.sendOutputReport(REPORT_ID, p);
      await this.waitForEcho(KEYMAP_CMD);
    }
    await this.opts.store.set(`${this.key}/keymap`, {
      layer: 'base',
      slots: state.slots,
      provenance: 'mirror',
      updatedAt: new Date().toISOString(),
    } satisfies KeymapState);
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
      'Lighting packet captured from the vendor software by Mqlvin/keyboard-colour, which an MK870 owner ran on 0416:C345; per-key, key map, media keys and sleep decoded from the official FL Esports driver. Not yet run by OpenKey on hardware.',
    safety:
      'Nothing is sent while detecting: the keyboard is identified from its USB identity, product string and exact report layout. Only the lighting, per-key, key-map and sleep packets of the official driver are sent, behind the experimental opt-in; the read-only lighting query runs only when the user starts a protocol check. The firmware-update (0B), serial-number (16) and LCD-firmware (22) commands are never sent.',
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
      'Per-key LED order is the official driver’s matrix, confirmed on a sibling board (Pulsar PCMK TKL), not yet on an MK870.',
      'The key map, per-key colours and sleep time cannot be read from the keyboard; OpenKey shows what it last wrote.',
      'Key map: the default layer (keys, two-modifier combinations, nine media keys); the FN1/FN layers are not written because their factory contents are unknown.',
      'Macros: the vendor app plays them itself (key reports 04/05); the keyboard’s macro list (19) is sent empty, so there is nothing to store on the keyboard.',
      'Lighting is read back only when the keyboard answers the lighting query; otherwise OpenKey shows what it last wrote.',
      'Musical rhythm needs the vendor software’s audio stream and is not offered.',
    ],
    fixtures: [],
    verifiedIdentities: [],
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
    });
  },
};

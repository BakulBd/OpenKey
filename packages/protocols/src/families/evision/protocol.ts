import {
  BaseKeyboardDriver,
  Evidence,
  FeatureStatus,
  ProtocolError,
  SafetyLevel,
  configurable,
  emptyCapabilities,
  feature,
} from '@openkey/core';
import type {
  Capabilities,
  DeviceInfo,
  EffectCatalog,
  KeyboardLayout,
  PerKeyRgb,
  RgbConfig,
  StateStore,
  TransportMode,
} from '@openkey/core';
import { ansiLayout } from '@openkey/devices';
import { LoggingTransport } from '@openkey/hid';
import type {
  HidCollection,
  HidDeviceGroup,
  HidDeviceGroupInfo,
  HidInterfaceInfo,
  HidTransport,
} from '@openkey/hid';
import type {
  CandidateMatch,
  ProbeContext,
  ProbeResult,
  ProtocolDefinition,
} from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';

/**
 * EVision keyboard firmware (Sonix-based boards sold as Redragon, Glorious, AJAZZ, Endorfy …).
 * Facts from OpenRGB Controllers/EVisionKeyboardController (GPL-2.0; facts only):
 *
 * - vendor collection usage page 0xFF1C, output report 4 of 63 bytes, each answered by an input report;
 * - packet `04 ckLo ckHi cmd size param/offsetLo offsetHi 00 data…`, checksum = 16-bit sum of bytes 3–63;
 * - 0x06 SET_PARAMETER from parameter 0: mode, brightness (0–4), speed (0 fastest – 5 slowest),
 *   direction (0 left, 1 right), random flag, R, G, B; stored by the keyboard;
 * - 0x11 WRITE_CUSTOM_COLOR_DATA: 126 LEDs × RGB in packets of up to 0x36 bytes at an offset,
 *   shown by mode 0x14 (custom);
 * - LED index of each key from OpenRGB's 6 × 23 EVision matrix (a full-size ANSI board).
 */
export const EVISION_PROTOCOL_ID = 'evision';
export const USAGE_PAGE = 0xff1c;
export const REPORT_ID = 4;
export const REPORT_BYTES = 63;
const LEDS = 126;
const CHUNK = 0x36;

export const Cmd = { SET_PARAMETER: 0x06, WRITE_CUSTOM: 0x11 } as const;
export const CUSTOM_MODE = 0x14;

/** USB identities OpenRGB detects as EVision keyboards. */
export const EVISION_IDS: readonly [number, number][] = [
  [0x0c45, 0x5004],
  [0x0c45, 0x5104],
  [0x0c45, 0x5204],
  [0x0c45, 0x652f],
  [0x0c45, 0x7672],
  [0x0c45, 0x7698],
  [0x0c45, 0x8520],
  [0x320f, 0x5000],
  [0x320f, 0x502a],
  [0x320f, 0x505b],
  [0x320f, 0x5064],
  [0x320f, 0x5078],
  [0x320f, 0x5084],
];

/** EVision effects with the vendor's own names. */
export const MODES: readonly [
  number,
  string,
  { color: boolean; speed: boolean; direction: boolean },
][] = [
  [0x06, 'Static (Normally on)', { color: true, speed: false, direction: false }],
  [0x05, 'Breathing', { color: true, speed: true, direction: false }],
  [0x04, 'Spectrum cycle (The trial of light)', { color: false, speed: true, direction: false }],
  [0x02, 'Colour wave (Clouds fly)', { color: true, speed: true, direction: true }],
  [0x01, 'Colour wave, short (Go with the stream)', { color: true, speed: true, direction: true }],
  [0x03, 'Colour wheel (Winding paths)', { color: true, speed: true, direction: true }],
  [0x07, 'Reactive (Pass without trace)', { color: true, speed: true, direction: false }],
  [0x08, 'Reactive ripple (Ripple graff)', { color: true, speed: true, direction: false }],
  [0x09, 'Reactive line (Fast run without trace)', { color: true, speed: true, direction: false }],
  [0x0a, 'Starlight (Swift action)', { color: true, speed: true, direction: false }],
  [0x0f, 'Starlight, slow (Digital times)', { color: true, speed: true, direction: false }],
  [0x0b, 'Blooming (Flowers blooming)', { color: true, speed: true, direction: false }],
  [
    0x0c,
    'Rainbow wave, vertical (Snow winter jasmine)',
    { color: true, speed: true, direction: false },
  ],
  [0x0d, 'Hurricane', { color: true, speed: true, direction: false }],
  [0x0e, 'Accumulate', { color: true, speed: true, direction: false }],
  [0x10, 'Visor (Both ways)', { color: true, speed: false, direction: false }],
  [
    0x12,
    'Rainbow wave, circle (Fast and the Furious)',
    { color: false, speed: true, direction: false },
  ],
  [CUSTOM_MODE, 'Custom (per-key colours)', { color: false, speed: false, direction: false }],
];

/** LED index of each key, from OpenRGB's EVision matrix (full-size ANSI). */
const LED: Record<string, number> = {
  Esc: 0,
  F1: 1,
  F2: 2,
  F3: 3,
  F4: 4,
  F5: 5,
  F6: 6,
  F7: 7,
  F8: 8,
  F9: 9,
  F10: 10,
  F11: 11,
  F12: 12,
  PrtSc: 14,
  ScrLk: 15,
  Pause: 16,
  '`': 21,
  '1': 22,
  '2': 23,
  '3': 24,
  '4': 25,
  '5': 26,
  '6': 27,
  '7': 28,
  '8': 29,
  '9': 30,
  '0': 31,
  '-': 32,
  '=': 33,
  Backspace: 34,
  Ins: 35,
  Home: 36,
  PgUp: 37,
  NumLock: 38,
  'KP/': 39,
  'KP*': 40,
  'KP-': 41,
  Tab: 42,
  Q: 43,
  W: 44,
  E: 45,
  R: 46,
  T: 47,
  Y: 48,
  U: 49,
  I: 50,
  O: 51,
  P: 52,
  '[': 53,
  ']': 54,
  '\\': 55,
  Del: 56,
  End: 57,
  PgDn: 58,
  KP7: 59,
  KP8: 60,
  KP9: 61,
  'KP+': 62,
  Caps: 63,
  A: 64,
  S: 65,
  D: 66,
  F: 67,
  G: 68,
  H: 69,
  J: 70,
  K: 71,
  L: 72,
  ';': 73,
  "'": 74,
  Enter: 76,
  KP4: 80,
  KP5: 81,
  KP6: 82,
  LShift: 84,
  Z: 86,
  X: 87,
  C: 88,
  V: 89,
  B: 90,
  N: 91,
  M: 92,
  ',': 93,
  '.': 94,
  '/': 95,
  RShift: 97,
  Up: 99,
  KP1: 101,
  KP2: 102,
  KP3: 103,
  KPEnter: 104,
  LCtrl: 105,
  LWin: 106,
  LAlt: 107,
  Space: 108,
  RAlt: 109,
  Fn: 110,
  Menu: 111,
  RCtrl: 113,
  Left: 119,
  Down: 120,
  Right: 121,
  KP0: 123,
  'KP.': 124,
};

/** A command packet (without the report ID). */
export function packet(
  cmd: number,
  size: number,
  param: number,
  data: readonly number[],
): Uint8Array {
  if (!Object.values(Cmd).includes(cmd as 6))
    throw new ProtocolError(`EVision command 0x${cmd.toString(16)} is not sent by OpenKey.`);
  const p = new Uint8Array(REPORT_BYTES);
  // Byte n of the 64-byte report (with report ID) is p[n - 1].
  p[2] = cmd;
  p[3] = size;
  p[4] = param & 0xff;
  p[5] = param >> 8;
  p.set(data, 7);
  let sum = 0;
  for (let i = 2; i < REPORT_BYTES; i++) sum += p[i]!;
  p[0] = sum & 0xff;
  p[1] = (sum >> 8) & 0xff;
  return p;
}

const isChannel = (c: HidCollection) =>
  c.usagePage === USAGE_PAGE &&
  c.outputReports.some((r) => r.reportId === REPORT_ID && r.size === REPORT_BYTES);
const channel = (g: HidDeviceGroupInfo) => g.interfaces.find((i) => i.collections.some(isChannel));
const listed = (g: HidDeviceGroupInfo) =>
  EVISION_IDS.some(([v, p]) => v === g.identity.vendorId && p === g.identity.productId);

interface Mirror {
  rgb: RgbConfig;
  perKey: PerKeyRgb;
}

export class EVisionDriver extends BaseKeyboardDriver {
  readonly protocolId = EVISION_PROTOCOL_ID;
  readonly transport: TransportMode;
  private t: HidTransport | null = null;
  private readonly layout: KeyboardLayout;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    private readonly opts: {
      store: StateStore;
      open: (i: HidInterfaceInfo) => Promise<HidTransport>;
    },
  ) {
    super();
    this.transport = group.transportHint;
    this.layout = ansiLayout({
      id: 'evision',
      name: 'EVision keyboard (full-size map; smaller boards use the matching part)',
      size: 'full',
      rightMods: 'fn',
      light: (n) => LED[n] ?? null,
      source: 'LED indices from OpenRGB’s EVision matrix map (facts only); standard ANSI geometry.',
    });
  }

  private get key(): string {
    const id = this.group.identity;
    return `evision/${id.vendorId.toString(16)}:${id.productId.toString(16)}`;
  }

  async connect(): Promise<void> {
    this.t = await this.opts.open(this.iface);
  }

  async disconnect(): Promise<void> {
    const t = this.t;
    this.t = null;
    await t?.close().catch(() => undefined);
  }

  getLayout(): KeyboardLayout {
    return this.layout;
  }

  /** One packet; the keyboard answers each with an input report, which is read to pace the next. */
  private async send(p: Uint8Array): Promise<void> {
    if (!this.t) throw new ProtocolError('Not connected');
    this.t.drainInput();
    await this.t.sendOutputReport(REPORT_ID, p);
    await this.t.readInputReport(200);
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const src = 'OpenRGB EVision controller (facts only), used on these boards by its users';
    const note =
      'Stored by the keyboard. It cannot report its lighting, so OpenKey shows what it last wrote.';
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.OBSERVED,
      source: 'USB identity in OpenRGB’s EVision list',
    });
    c.rgb = configurable('mirror', true, Evidence.INFERRED, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: src,
      note,
    });
    c.perKeyRgb = configurable('mirror', true, Evidence.INFERRED, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: src,
      value: '126 LEDs (full-size map)',
      note,
    });
    c.keymap = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
      confidence: Evidence.UNKNOWN,
      note: 'The EVision key-map commands are not documented by any open project.',
    });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      model: this.group.identity.productName || 'EVision keyboard',
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
        name: 'EVision keyboard firmware (report 4, usage page FF1C)',
      },
      battery: null,
      fields: [],
    };
  }

  override getRgbEffects(): EffectCatalog {
    return {
      effects: MODES.map(([id, name, c]) => ({
        id,
        name,
        controls: {
          color: c.color,
          colorful: c.color,
          brightness: true,
          speed: c.speed,
          direction: c.direction ? ['left', 'right'] : [],
        },
      })),
      brightness: { min: 0, max: 4 },
      speed: { min: 0, max: 5 },
      customEffect: CUSTOM_MODE,
    };
  }

  private async mirror(): Promise<Mirror> {
    return (
      (await this.opts.store.get<Mirror>(this.key)) ?? {
        rgb: {
          effect: 0x04,
          color: { r: 255, g: 0, b: 0 },
          colorful: false,
          brightness: 4,
          speed: 2,
          direction: 'left',
        },
        perKey: {},
      }
    );
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    return (await this.mirror()).rgb;
  }

  override async setRgbConfig(c: RgbConfig): Promise<void> {
    if (!MODES.some(([id]) => id === c.effect))
      throw new ProtocolError(`Effect ${c.effect} is not offered.`);
    const b = Math.max(0, Math.min(4, Math.round(c.brightness)));
    // OpenKey's speed grows with the slider; EVision's 0 is the fastest.
    const speed = 5 - Math.max(0, Math.min(5, Math.round(c.speed)));
    await this.send(
      packet(Cmd.SET_PARAMETER, 8, 0, [
        c.effect,
        b,
        speed,
        c.direction === 'right' ? 1 : 0,
        c.colorful ? 1 : 0,
        c.color.r,
        c.color.g,
        c.color.b,
      ]),
    );
    const m = await this.mirror();
    await this.opts.store.set(this.key, { ...m, rgb: { ...c, brightness: b } });
  }

  override async getPerKeyRgb(): Promise<PerKeyRgb> {
    return (await this.mirror()).perKey;
  }

  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    const data = new Array<number>(CHUNK * 7).fill(0);
    for (let i = 0; i < LEDS; i++) {
      const c = colors[i];
      if (c) data.splice(i * 3, 3, c.r, c.g, c.b);
    }
    for (let off = 0; off < data.length; off += CHUNK)
      await this.send(packet(Cmd.WRITE_CUSTOM, CHUNK, off, data.slice(off, off + CHUNK)));
    const m = await this.mirror();
    if (m.rgb.effect !== CUSTOM_MODE) await this.setRgbConfig({ ...m.rgb, effect: CUSTOM_MODE });
    const after = await this.mirror();
    await this.opts.store.set(this.key, { ...after, perKey: colors });
  }
}

export const evisionProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: EVISION_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb'], configuration: ['usb'] },
    verification:
      'Implemented from OpenRGB’s EVision controller, which its users run on these boards; tested against a simulator, not yet run by OpenKey.',
    safety:
      'Write-only protocol with no identity read: the board is identified from OpenRGB’s USB list plus the exact report layout, and nothing is sent while detecting. Only the lighting parameter and custom-colour commands are sent.',
    provenance: [
      {
        source: 'public-reverse-engineering',
        reference:
          'OpenRGB Controllers/EVisionKeyboardController (GPL-2.0; facts only): packets, modes, LED matrix',
        status: Evidence.INFERRED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Lighting only; key maps and macros are not documented.',
      'The keyboard cannot report its settings; OpenKey shows what it last wrote.',
      'The per-key map is the full-size one; on smaller boards only the keys present light up.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'EVision keyboard firmware (Redragon, Glorious, AJAZZ and other Sonix boards)',
  family: EVISION_PROTOCOL_ID,
  priority: 42,
  supportedDevices: '0C45:5004/5104/5204/652F/7672/7698/8520, 320F:5000/502A/505B/5064/5078/5084',
  supportedFirmware: 'EVision keyboard firmware (usage page FF1C)',
  requiredUsagePages: [USAGE_PAGE],
  requiredReports: ['FF1C output id 4 63B'],
  evidence: ['OpenRGB EVisionKeyboardController'],
  probePlan: {
    operations: [],
    autoConsent: (g) =>
      listed(g)
        ? {
            auto: true,
            reason:
              'no packet is sent: the board is identified from its USB identity and report layout',
          }
        : { auto: false, reason: 'not a listed EVision identity' },
    identifiedBy: 'vendor-model-list',
  },
  match(group): CandidateMatch {
    const ch = channel(group);
    if (!ch)
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['no FF1C collection with output report 4 (63 B)'],
      };
    if (!listed(group))
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['USB identity not in the EVision list'],
      };
    return {
      applicable: true,
      score: 60,
      reasons: ['FF1C output report 4 (63 B)', 'USB identity in OpenRGB’s EVision list'],
      rejections: [],
    };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const ok = listed(ctx.group) && !!channel(ctx.group);
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.INFERRED : Evidence.HYPOTHESIS,
      summary: ok
        ? 'EVision keyboard: identified from its USB identity and report layout (no read command exists)'
        : 'Not an EVision keyboard',
      steps: [
        { name: 'model list', status: ok ? 'pass' : 'fail', detail: ok ? 'listed' : 'not listed' },
      ],
      facts: {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const ch = channel(group);
    if (!ch || !listed(group)) throw new Error('Not an EVision keyboard');
    return new EVisionDriver(group, ch, {
      store: opts.store,
      open: async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
    });
  },
};

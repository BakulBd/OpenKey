import {
  BaseKeyboardDriver,
  Evidence,
  FeatureStatus,
  ProtocolError,
  SafetyLevel,
  TimeoutError,
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
  Rgb,
  RgbConfig,
  StateStore,
  TransportMode,
} from '@openkey/core';
import { ansiKeys, ansiLayout } from '@openkey/devices';
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
 * Logitech G keyboards over HID++ 2.0. Facts from Solaar (lib/logitech_receiver: hidpp20.py,
 * settings_templates.py, rgb_power.py; GPL-2.0) and OpenRGB (Controllers/LogitechController;
 * GPL-2.0), facts only:
 *
 * - long reports, ID 0x11, 19 bytes: `device feature function|swid params…`; errors come back with
 *   feature 0xFF; device 0xFF on a cable, 1 behind a Lightspeed receiver;
 * - the root feature (index 0) answers `ping` (function 1) and `getFeature` (function 0), so every
 *   other feature is found by its id, never by a hard-coded index;
 * - 0x0005 device name, 0x1004 unified battery / 0x1000 battery status;
 * - 0x8071 RGB effects: `setSWControl` (function 5) `01 03 04` takes the lighting, `01 00 00`
 *   gives it back; 0x8100 on-board profiles: function 1 `02` host mode, `01` on-board mode;
 * - 0x8081 per-key lighting: function 1 sets up to four `zone R G B`, function 7 ends the frame.
 *   Zone of a key: HID usage − 3; modifiers usage − 0x78; logo 0xD2.
 */
export const LOGITECH_PROTOCOL_ID = 'logitech-hidpp';
const VID = 0x046d;
export const LONG_ID = 0x11;
const LONG_BYTES = 19;
const SWID = 0x0a;

export const Feature = {
  ROOT: 0x0000,
  DEVICE_NAME: 0x0005,
  BATTERY_STATUS: 0x1000,
  UNIFIED_BATTERY: 0x1004,
  RGB_EFFECTS: 0x8071,
  PER_KEY_LIGHTING_V2: 0x8081,
  ONBOARD_PROFILES: 0x8100,
} as const;

export class HidppError extends ProtocolError {}

export class HidppSession {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly transport: HidTransport,
    readonly device: number,
  ) {}

  /** One request; the reply echoes device, feature index and function. */
  call(
    index: number,
    fn: number,
    params: readonly number[] = [],
    timeoutMs = 500,
  ): Promise<Uint8Array> {
    const run = async () => {
      const r = new Uint8Array(LONG_BYTES);
      r[0] = this.device;
      r[1] = index;
      r[2] = (fn << 4) | SWID;
      r.set(params.slice(0, LONG_BYTES - 3), 3);
      this.transport.drainInput();
      await this.transport.sendOutputReport(LONG_ID, r);
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const a = await this.transport.readInputReport(Math.max(1, deadline - Date.now()));
        if (!a)
          throw new TimeoutError(
            'The keyboard did not answer (asleep, or not paired with this receiver?).',
          );
        if (a[0] !== this.device) continue;
        if (a[1] === 0xff && a[2] === index && a[3] === r[2])
          throw new HidppError(`HID++ error ${a[4]} on feature index ${index}, function ${fn}.`);
        if (a[1] === index && a[2] === r[2]) return a.subarray(3);
        if (Date.now() >= deadline) throw new TimeoutError('The keyboard did not answer.');
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Root ping: HID++ 2.0 devices answer with their protocol version. */
  async ping(): Promise<{ major: number; minor: number }> {
    const r = await this.call(0, 1, [0, 0, 0x5a]);
    if (r[2] !== 0x5a) throw new ProtocolError('Ping answered with the wrong token.');
    return { major: r[0]!, minor: r[1]! };
  }

  /** Index of a feature (0 when absent). */
  async featureIndex(id: number): Promise<number> {
    if (id === 0) return 0;
    const r = await this.call(0, 0, [id >> 8, id & 0xff]);
    return r[0]!;
  }
}

/** Per-key zone id of a key, from its HID usage. */
export function zoneOf(usage: number): number | null {
  if (usage >= 0x04 && usage <= 0xa4) return usage - 3;
  if (usage >= 0xe0 && usage <= 0xe7) return usage - 0x78;
  return null;
}
export const LOGO_ZONE = 0xd2;

const LIGHTSPEED_RECEIVERS = new Set([0xc539, 0xc53a, 0xc53f, 0xc541, 0xc545, 0xc547, 0xc548]);

const isLong = (c: HidCollection) =>
  c.outputReports.some((r) => r.reportId === LONG_ID && r.size === LONG_BYTES) &&
  c.inputReports.some((r) => r.reportId === LONG_ID && r.size === LONG_BYTES);
const channel = (g: HidDeviceGroupInfo) => g.interfaces.find((i) => i.collections.some(isLong));

export const Effect = { ONBOARD: 0, SOLID: 1, PER_KEY: 2 } as const;

interface Mirror {
  rgb: RgbConfig;
  perKey: PerKeyRgb;
}

export class LogitechDriver extends BaseKeyboardDriver {
  readonly protocolId = LOGITECH_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: HidppSession | null = null;
  readonly features = new Map<number, number>();
  name = '';
  version: { major: number; minor: number } | null = null;
  private claimed = false;
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
    // A key's zone follows its HID usage, so the layout is built from usages.
    const usage = new Map(ansiKeys('full', 'fn').map((k) => [k.name, k.usage]));
    const zone = (n: string) => zoneOf(usage.get(n) ?? 0);
    this.layout = ansiLayout({
      id: 'logitech-hidpp',
      name: 'Logitech G keyboard (ANSI; keys light where the board has them)',
      size: 'full',
      rightMods: 'fn',
      light: zone,
      slot: (n) => zone(n) ?? -1,
      source: 'Per-key zones from HID usages (Solaar/OpenRGB facts); standard ANSI geometry.',
    });
  }

  private s(): HidppSession {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  private get key(): string {
    return `logitech/${this.group.identity.productId.toString(16)}`;
  }

  get perKey(): boolean {
    return this.features.has(Feature.PER_KEY_LIGHTING_V2);
  }

  async connect(): Promise<void> {
    const t = await this.opts.open(this.iface);
    const device = LIGHTSPEED_RECEIVERS.has(this.group.identity.productId) ? 0x01 : 0xff;
    this.session = new HidppSession(t, device);
    this.version = await this.session.ping();
    for (const f of [
      Feature.DEVICE_NAME,
      Feature.UNIFIED_BATTERY,
      Feature.BATTERY_STATUS,
      Feature.RGB_EFFECTS,
      Feature.PER_KEY_LIGHTING_V2,
      Feature.ONBOARD_PROFILES,
    ]) {
      const idx = await this.session.featureIndex(f).catch(() => 0);
      if (idx) this.features.set(f, idx);
    }
    this.name = await this.readName().catch(() => '');
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    this.claimed = false;
    await s?.transport.close().catch(() => undefined);
  }

  private async readName(): Promise<string> {
    const idx = this.features.get(Feature.DEVICE_NAME);
    if (!idx) return '';
    const len = (await this.s().call(idx, 0))[0]!;
    let out = '';
    while (out.length < len) {
      const r = await this.s().call(idx, 1, [out.length]);
      const chunk = String.fromCharCode(...r.subarray(0, Math.min(16, len - out.length)));
      if (!chunk) break;
      out += chunk;
    }
    return out.replace(/\0+$/, '');
  }

  getLayout(): KeyboardLayout {
    return this.layout;
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const src = 'Solaar and OpenRGB (facts only): HID++ 2.0 features 0x8071 / 0x8081';
    const note =
      'Set by OpenKey while it holds the lighting; “Keyboard’s own lighting” hands it back to the on-board profile. Not stored, and not readable.';
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.OBSERVED,
      source: 'HID++ device name (0x0005)',
    });
    if (this.features.has(Feature.UNIFIED_BATTERY) || this.features.has(Feature.BATTERY_STATUS))
      c.battery = feature(FeatureStatus.READ_ONLY, {
        read: 'device',
        confidence: Evidence.OBSERVED,
        source: 'HID++ battery feature',
      });
    if (this.perKey) {
      c.rgb = configurable('mirror', true, Evidence.INFERRED, {
        safety: SafetyLevel.SAFE_VOLATILE,
        source: src,
        note,
      });
      c.perKeyRgb = configurable('mirror', true, Evidence.INFERRED, {
        safety: SafetyLevel.SAFE_VOLATILE,
        source: src,
        note,
      });
    } else {
      c.rgb = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
        confidence: Evidence.INFERRED,
        note: 'This device has no per-key lighting feature (0x8081); its zone effects are not supported yet.',
      });
    }
    c.keymap = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
      confidence: Evidence.INFERRED,
      note: 'G-key and on-board profile programming stay in G HUB.',
    });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const battery = await this.getBattery().catch(() => null);
    return {
      model: this.name
        ? `Logitech ${this.name}`
        : this.group.identity.productName || 'Logitech keyboard',
      profileId: this.key.replace('/', '-'),
      identity: this.group.identity,
      firmware: { version: null, source: 'not read', confidence: Evidence.UNKNOWN },
      transport: this.transport,
      protocol: {
        id: this.protocolId,
        name: 'Logitech HID++',
        ...(this.version ? { revision: `${this.version.major}.${this.version.minor}` } : {}),
      },
      battery,
      fields: [
        {
          key: 'features',
          label: 'Lighting features',
          value:
            [
              this.features.has(Feature.RGB_EFFECTS) && '0x8071 effects',
              this.perKey && '0x8081 per-key',
            ]
              .filter(Boolean)
              .join(', ') || 'none',
          confidence: Evidence.VERIFIED,
          source: 'HID++ root getFeature',
        },
      ],
    };
  }

  override async getBattery(): Promise<{ level: number; charging: boolean } | null> {
    const u = this.features.get(Feature.UNIFIED_BATTERY);
    if (u) {
      const r = await this.s().call(u, 1);
      const levels: Record<number, number> = { 8: 100, 4: 50, 2: 20, 1: 5 };
      return { level: r[0] || (levels[r[1]!] ?? 0), charging: [1, 2, 4].includes(r[2]!) };
    }
    const b = this.features.get(Feature.BATTERY_STATUS);
    if (b) {
      const r = await this.s().call(b, 0);
      return { level: r[0]!, charging: [1, 2, 4].includes(r[2]!) };
    }
    return null;
  }

  override getRgbEffects(): EffectCatalog {
    const none = { color: false, colorful: false, brightness: false, speed: false, direction: [] };
    return {
      effects: [
        { id: Effect.ONBOARD, name: 'Keyboard’s own lighting (on-board profile)', controls: none },
        {
          id: Effect.SOLID,
          name: 'Solid colour',
          controls: { ...none, color: true, brightness: true },
        },
        { id: Effect.PER_KEY, name: 'Per-key colours', controls: none },
      ],
      brightness: { min: 0, max: 10 },
      speed: { min: 0, max: 0 },
      customEffect: Effect.PER_KEY,
    };
  }

  private async mirror(): Promise<Mirror> {
    return (
      (await this.opts.store.get<Mirror>(this.key)) ?? {
        rgb: {
          effect: Effect.ONBOARD,
          color: { r: 255, g: 255, b: 255 },
          colorful: false,
          brightness: 10,
          speed: 0,
          direction: 'right',
        },
        perKey: {},
      }
    );
  }

  private async claim(): Promise<void> {
    if (this.claimed) return;
    const p = this.features.get(Feature.ONBOARD_PROFILES);
    if (p) await this.s().call(p, 1, [0x02]);
    const e = this.features.get(Feature.RGB_EFFECTS);
    if (e) await this.s().call(e, 5, [0x01, 0x03, 0x04]);
    this.claimed = true;
  }

  private async release(): Promise<void> {
    const e = this.features.get(Feature.RGB_EFFECTS);
    if (e) await this.s().call(e, 5, [0x01, 0x00, 0x00]);
    const p = this.features.get(Feature.ONBOARD_PROFILES);
    if (p) await this.s().call(p, 1, [0x01]);
    this.claimed = false;
  }

  private async frame(colorOf: (zone: number) => Rgb): Promise<void> {
    const idx = this.features.get(Feature.PER_KEY_LIGHTING_V2);
    if (!idx) throw new ProtocolError('This keyboard has no per-key lighting feature.');
    await this.claim();
    const zones = [
      ...new Set([
        ...this.layout.keys.map((k) => k.light).filter((z): z is number => z !== null),
        LOGO_ZONE,
      ]),
    ];
    for (let i = 0; i < zones.length; i += 4) {
      const params: number[] = [];
      for (const z of zones.slice(i, i + 4)) {
        const c = colorOf(z);
        params.push(z, c.r, c.g, c.b);
      }
      await this.s().call(idx, 1, params);
    }
    await this.s().call(idx, 7, [0]);
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    return (await this.mirror()).rgb;
  }

  override async setRgbConfig(c: RgbConfig): Promise<void> {
    const m = await this.mirror();
    if (c.effect === Effect.ONBOARD) await this.release();
    else if (c.effect === Effect.SOLID) {
      const k = Math.max(0, Math.min(10, c.brightness)) / 10;
      const col = {
        r: Math.round(c.color.r * k),
        g: Math.round(c.color.g * k),
        b: Math.round(c.color.b * k),
      };
      await this.frame(() => col);
    } else if (c.effect === Effect.PER_KEY)
      await this.frame((z) => m.perKey[z] ?? { r: 0, g: 0, b: 0 });
    else throw new ProtocolError(`Effect ${c.effect} is not offered.`);
    await this.opts.store.set(this.key, { ...m, rgb: c });
  }

  override async getPerKeyRgb(): Promise<PerKeyRgb> {
    return (await this.mirror()).perKey;
  }

  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    await this.frame((z) => colors[z] ?? { r: 0, g: 0, b: 0 });
    const m = await this.mirror();
    await this.opts.store.set(this.key, {
      perKey: colors,
      rgb: { ...m.rgb, effect: Effect.PER_KEY },
    });
  }
}

export const logitechProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: LOGITECH_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb', '2.4ghz', 'bluetooth'], configuration: ['usb', '2.4ghz'] },
    verification:
      'Implemented from Solaar and OpenRGB, which their users run on these keyboards; tested against a simulator, not yet run by OpenKey on a Logitech keyboard.',
    safety:
      'Every feature is looked up by id through HID++’s root feature (never a hard-coded index). Only the documented lighting take/give-back calls and per-key frames are sent; on-board profile contents, DPI, G-keys and firmware are never touched.',
    provenance: [
      {
        source: 'public-reverse-engineering',
        reference: 'pwr-Solaar/Solaar lib/logitech_receiver (GPL-2.0; facts only)',
        status: Evidence.INFERRED,
      },
      {
        source: 'public-reverse-engineering',
        reference: 'OpenRGB Controllers/LogitechController (GPL-2.0; facts only)',
        status: Evidence.INFERRED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Per-key and solid colours on keyboards with feature 0x8081 (G815, G915, G915 TKL and similar); zone-only devices are not configured yet.',
      'Colours are not stored and cannot be read back; G HUB may take the lighting back while it runs.',
      'G-keys, on-board profiles and macros stay in G HUB.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'Logitech G keyboards (HID++ 2.0)',
  family: LOGITECH_PROTOCOL_ID,
  priority: 45,
  supportedDevices:
    'Logitech G keyboards with HID++ 2.0 per-key lighting (cable or Lightspeed receiver)',
  supportedFirmware: 'HID++ 2.0',
  requiredUsagePages: [],
  requiredReports: ['HID++ long report 0x11 (19 B, in + out)'],
  evidence: ['Solaar', 'OpenRGB LogitechController'],
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'output',
        collection: 'FF00:0002',
        reportId: LONG_ID,
        payloadPrefix: 'FF 00 1A',
        purpose:
          'HID++ root ping (device FF, feature 0, function 1; device 01 behind a receiver): read-only; G HUB, Solaar and the Linux kernel send it to every Logitech device.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
      {
        level: 'handshake',
        op: 'input-read',
        collection: 'FF00:0002',
        reportId: LONG_ID,
        payloadPrefix: '',
        purpose: 'The answer carries the HID++ protocol version and echoes the ping token.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
    ],
    autoConsent: (g) =>
      g.identity.vendorId === VID
        ? {
            auto: true,
            reason:
              'the HID++ ping is what G HUB, Solaar and the Linux kernel send to every Logitech device',
          }
        : { auto: false, reason: 'not a Logitech device' },
  },
  match(group): CandidateMatch {
    if (group.identity.vendorId !== VID)
      return { applicable: false, score: 0, reasons: [], rejections: ['not a Logitech device'] };
    if (!channel(group))
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['no HID++ long report (0x11, 19 B)'],
      };
    return {
      applicable: true,
      score: 55,
      reasons: ['Logitech vendor ID', 'HID++ long report 0x11'],
      rejections: [],
    };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const ch = channel(ctx.group);
    if (ctx.level !== 'handshake' || !ch || ctx.group.identity.vendorId !== VID)
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
        summary: 'Descriptor signature only.',
        steps: [],
        facts: {},
      };
    const device = LIGHTSPEED_RECEIVERS.has(ctx.group.identity.productId) ? 0x01 : 0xff;
    const s = new HidppSession(await ctx.open(ch), device);
    const v = await s.ping().catch(() => null);
    const ok = !!v && v.major >= 2;
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.VERIFIED : Evidence.HYPOTHESIS,
      summary: ok ? `HID++ ${v!.major}.${v!.minor}` : 'No HID++ 2.0 answer',
      steps: [
        {
          name: 'root ping',
          status: ok ? 'pass' : 'fail',
          detail: v ? `${v.major}.${v.minor}` : 'no answer',
        },
      ],
      facts: ok ? { hidpp: `${v!.major}.${v!.minor}` } : {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const ch = channel(group);
    if (!ch) throw new Error('No HID++ channel');
    return new LogitechDriver(group, ch, {
      store: opts.store,
      open: async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
    });
  },
};

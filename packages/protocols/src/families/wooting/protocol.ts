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
 * Wooting keyboards, through the public Wooting RGB SDK protocol (WootingKb/wooting-rgb-sdk,
 * MPL-2.0; src/wooting-usb.c). Facts used:
 *
 * - configuration collection: usage page 0x1337 (v2 firmware) or 0xFF55 (v3, "multi-report");
 * - commands are 7-byte feature reports `D0 DA cmd p3 p2 p1 p0` (report ID 0; v3: `D1 DA …`,
 *   report ID 1), each answered by one response report;
 * - 33 COLOR_INIT takes the lighting, 32 RESET_ALL gives it back to the keyboard's profile,
 *   19 DEVICE_CONFIG is a read;
 * - colours: output report `D0 DA 0B` + 6 × 21 RGB565 (little-endian) cells, row by row; boards
 *   with 64-byte reports take it as four 64-byte reports, v3 as report 5 (`D1 DA 0B`).
 *
 * Colours set this way are not stored: the keyboard returns to its profile lighting on unplug or
 * after RESET_ALL. Analog, actuation and profile settings stay in Wootility.
 */
export const WOOTING_PROTOCOL_ID = 'wooting-rgb';
export const ROWS = 6;
export const COLS = 21;
export const CFG_V2 = 0x1337;
export const CFG_V3 = 0xff55;

export const Cmd = { DEVICE_CONFIG: 19, RESET_ALL: 32, COLOR_INIT: 33 } as const;
const RAW_COLORS = 11;

interface Model {
  name: string;
  /** Base product id (v2 boards: + 0, 1 or 2 for the gamepad-driver alternatives). */
  pid: number;
  vid: number;
  cols: number;
  rows: number;
  alternates: boolean;
}

/** Models and LED grid sizes of the SDK's device table. */
const MODELS: readonly Model[] = [
  { name: 'Wooting One', vid: 0x03eb, pid: 0xff01, cols: 17, rows: 6, alternates: false },
  { name: 'Wooting Two', vid: 0x03eb, pid: 0xff02, cols: 21, rows: 6, alternates: false },
  { name: 'Wooting One', vid: 0x31e3, pid: 0x1100, cols: 17, rows: 6, alternates: true },
  { name: 'Wooting Two', vid: 0x31e3, pid: 0x1200, cols: 21, rows: 6, alternates: true },
  {
    name: 'Wooting Two Lekker Edition',
    vid: 0x31e3,
    pid: 0x1210,
    cols: 21,
    rows: 6,
    alternates: true,
  },
  { name: 'Wooting Two HE', vid: 0x31e3, pid: 0x1220, cols: 21, rows: 6, alternates: true },
  { name: 'Wooting Two HE (ARM)', vid: 0x31e3, pid: 0x1230, cols: 21, rows: 6, alternates: true },
  { name: 'Wooting 60HE', vid: 0x31e3, pid: 0x1300, cols: 14, rows: 6, alternates: true },
  { name: 'Wooting 60HE (ARM)', vid: 0x31e3, pid: 0x1310, cols: 14, rows: 6, alternates: true },
  { name: 'Wooting 60HE+', vid: 0x31e3, pid: 0x1320, cols: 14, rows: 6, alternates: true },
  { name: 'Wooting 60HE V2', vid: 0x31e3, pid: 0x1340, cols: 14, rows: 6, alternates: true },
  { name: 'Wooting 80HE', vid: 0x31e3, pid: 0x1400, cols: 17, rows: 6, alternates: true },
  { name: 'Wooting UwU RGB', vid: 0x31e3, pid: 0x1510, cols: 7, rows: 5, alternates: true },
];

export function wootingModel(vid: number, pid: number): Model | undefined {
  return MODELS.find(
    (m) =>
      m.vid === vid &&
      (m.pid === pid || (m.alternates && (pid & ~0x0f) === m.pid && (pid & 0x0f) <= 2)),
  );
}

interface Channel {
  iface: HidInterfaceInfo;
  v3: boolean;
  /** Output report size for colours (v2: 256 or 64). */
  outSize: number;
}

const isCfg = (c: HidCollection) => c.usagePage === CFG_V2 || c.usagePage === CFG_V3;
export function findChannel(g: HidDeviceGroupInfo): Channel | undefined {
  for (const iface of g.interfaces)
    for (const c of iface.collections)
      if (isCfg(c)) {
        const v3 = c.usagePage === CFG_V3;
        const out = c.outputReports.find((r) => r.reportId === (v3 ? 5 : 0))?.size ?? 256;
        return { iface, v3, outSize: out };
      }
  return undefined;
}

export function rgb565(c: Rgb): number {
  return ((c.r & 0xf8) << 8) | ((c.g & 0xfc) << 3) | ((c.b & 0xf8) >> 3);
}

/** The colour payload (without report ID): magic, report 11, 6 × 21 cells. */
export function colorPayload(v3: boolean, cells: readonly number[]): Uint8Array {
  const out = new Uint8Array(3 + ROWS * COLS * 2);
  out.set([v3 ? 0xd1 : 0xd0, 0xda, RAW_COLORS]);
  cells.forEach((v, i) => {
    out[3 + i * 2] = v & 0xff;
    out[4 + i * 2] = v >> 8;
  });
  return out;
}

export class WootingSession {
  constructor(
    readonly transport: HidTransport,
    readonly ch: Channel,
  ) {}

  /** A command and its response report. */
  async command(cmd: number, timeoutMs = 1000): Promise<Uint8Array> {
    this.transport.drainInput();
    await this.transport.sendFeatureReport(
      this.ch.v3 ? 1 : 0,
      Uint8Array.of(this.ch.v3 ? 0xd1 : 0xd0, 0xda, cmd, 0, 0, 0, 0),
    );
    const r = await this.transport.readInputReport(timeoutMs);
    if (!r) throw new TimeoutError('The keyboard did not answer.');
    return r;
  }

  async colors(cells: readonly number[]): Promise<void> {
    const payload = colorPayload(this.ch.v3, cells);
    if (this.ch.v3) {
      const r = new Uint8Array(510);
      r.set(payload);
      return this.transport.sendOutputReport(5, r);
    }
    if (this.ch.outSize === 64) {
      // The 256-byte report as four 64-byte reports (ARM boards).
      const full = new Uint8Array(256);
      full.set(payload);
      for (let i = 0; i < 4; i++)
        await this.transport.sendOutputReport(0, full.slice(i * 64, i * 64 + 64));
      return;
    }
    const r = new Uint8Array(256);
    r.set(payload);
    return this.transport.sendOutputReport(0, r);
  }
}

export const Effect = { KEYBOARD: 0, SOLID: 1, PER_KEY: 2 } as const;

interface Mirror {
  rgb: RgbConfig;
  perKey: PerKeyRgb;
}

export class WootingDriver extends BaseKeyboardDriver {
  readonly protocolId = WOOTING_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: WootingSession | null = null;
  private initialised = false;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly ch: Channel,
    readonly model: Model,
    private readonly opts: {
      store: StateStore;
      open: (i: HidInterfaceInfo) => Promise<HidTransport>;
    },
  ) {
    super();
    this.transport = group.transportHint;
  }

  private get key(): string {
    return `wooting/${this.group.identity.productId.toString(16)}`;
  }

  private s(): WootingSession {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  async connect(): Promise<void> {
    this.session = new WootingSession(await this.opts.open(this.ch.iface), this.ch);
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    this.initialised = false;
    await s?.transport.close().catch(() => undefined);
  }

  getLayout(): KeyboardLayout {
    const { rows, cols } = this.model;
    const keys = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        keys.push({
          id: `r${r}c${c}`,
          label: `${r + 1}·${c + 1}`,
          slot: r * COLS + c,
          light: r * COLS + c,
          usage: 0,
          x: c,
          y: r,
          w: 1,
          h: 1,
        });
    return {
      id: `wooting-${this.model.pid.toString(16)}`,
      name: `${this.model.name}: LED grid (${rows} × ${cols})`,
      width: cols,
      height: rows,
      keys,
      source:
        'LED grid from the Wooting RGB SDK (rows × columns); cells are positions, not key labels.',
    };
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const ev = Evidence.OBSERVED;
    const src = 'Wooting RGB SDK (official, MPL-2.0)';
    const note =
      'Not stored by the keyboard: it shows its own profile lighting again when unplugged or when you choose “Keyboard’s own lighting”.';
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: ev,
      source: 'device config (19)',
    });
    c.rgb = configurable('mirror', true, ev, {
      safety: SafetyLevel.SAFE_VOLATILE,
      source: src,
      note,
    });
    c.perKeyRgb = configurable('mirror', true, ev, {
      safety: SafetyLevel.SAFE_VOLATILE,
      source: src,
      value: `${this.model.rows * this.model.cols} cells`,
      note,
    });
    for (const f of ['keymap', 'actuation', 'rapidTrigger', 'analog'] as const)
      c[f] = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
        confidence: Evidence.INFERRED,
        note: 'Configured in Wootility (also in the browser); Wooting has not published this protocol.',
      });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      model: this.model.name,
      profileId: this.key.replace('/', '-'),
      identity: this.group.identity,
      firmware: { version: null, source: 'not read', confidence: Evidence.UNKNOWN },
      transport: this.transport,
      protocol: {
        id: this.protocolId,
        name: 'Wooting RGB SDK protocol',
        revision: this.ch.v3 ? 'v3 (multi-report)' : 'v2',
      },
      battery: null,
      fields: [],
    };
  }

  override getRgbEffects(): EffectCatalog {
    const none = { color: false, colorful: false, brightness: false, speed: false, direction: [] };
    return {
      effects: [
        { id: Effect.KEYBOARD, name: 'Keyboard’s own lighting (profile)', controls: none },
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
          effect: Effect.KEYBOARD,
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

  private async take(): Promise<void> {
    if (this.initialised) return;
    await this.s().command(Cmd.COLOR_INIT);
    this.initialised = true;
  }

  private cells(f: (i: number) => Rgb): number[] {
    return Array.from({ length: ROWS * COLS }, (_, i) => rgb565(f(i)));
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    return (await this.mirror()).rgb;
  }

  override async setRgbConfig(c: RgbConfig): Promise<void> {
    const m = await this.mirror();
    if (c.effect === Effect.KEYBOARD) {
      await this.s().command(Cmd.RESET_ALL);
      this.initialised = false;
    } else if (c.effect === Effect.SOLID) {
      const k = Math.max(0, Math.min(10, c.brightness)) / 10;
      const col = { r: c.color.r * k, g: c.color.g * k, b: c.color.b * k };
      await this.take();
      await this.s().colors(this.cells(() => col));
    } else if (c.effect === Effect.PER_KEY) {
      await this.take();
      await this.s().colors(this.cells((i) => m.perKey[i] ?? { r: 0, g: 0, b: 0 }));
    } else throw new ProtocolError(`Effect ${c.effect} is not offered.`);
    await this.opts.store.set(this.key, { ...m, rgb: c });
  }

  override async getPerKeyRgb(): Promise<PerKeyRgb> {
    return (await this.mirror()).perKey;
  }

  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    await this.take();
    await this.s().colors(this.cells((i) => colors[i] ?? { r: 0, g: 0, b: 0 }));
    const m = await this.mirror();
    await this.opts.store.set(this.key, {
      perKey: colors,
      rgb: { ...m.rgb, effect: Effect.PER_KEY },
    });
  }
}

export const wootingProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: WOOTING_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'experimental',
    transports: { input: ['usb'], configuration: ['usb'] },
    verification:
      'Implemented from Wooting’s own open-source RGB SDK; tested against a simulator, not yet run by OpenKey on a Wooting.',
    safety:
      'Uses only the SDK’s lighting commands: colours are not stored by the keyboard, and “Keyboard’s own lighting” returns control to its profile. Profiles, analog and actuation settings are never touched.',
    provenance: [
      {
        source: 'official-driver',
        reference: 'WootingKb/wooting-rgb-sdk src/wooting-usb.c, wooting-rgb-sdk.c (MPL-2.0)',
        status: Evidence.OBSERVED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Lighting only; analog, actuation, Rapid Trigger, key maps and profiles stay in Wootility.',
      'Colours are not stored and cannot be read back; OpenKey shows what it last sent.',
      'Per-key colours are set on the SDK’s LED grid (row · column), not on key labels.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'Wooting keyboards (RGB SDK protocol)',
  family: WOOTING_PROTOCOL_ID,
  priority: 50,
  supportedDevices: 'Wooting One, Two (all editions), 60HE (all), 80HE, UwU RGB',
  supportedFirmware: 'Wooting firmware with the RGB SDK interface (v2 0x1337, v3 0xFF55)',
  requiredUsagePages: [CFG_V2, CFG_V3],
  requiredReports: ['1337 or FF55 configuration collection'],
  evidence: ['WootingKb/wooting-rgb-sdk'],
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'feature-set',
        collection: '1337:0001',
        reportId: 0,
        payloadPrefix: 'D0 DA 13',
        purpose: 'DEVICE_CONFIG (19): a read the official SDK and Wootility send to every Wooting.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
      {
        level: 'handshake',
        op: 'input-read',
        collection: '1337:0001',
        reportId: 0,
        payloadPrefix: '',
        purpose: 'The response report carries the keyboard’s configuration (layout).',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
    ],
    autoConsent: (g) =>
      wootingModel(g.identity.vendorId, g.identity.productId)
        ? {
            auto: true,
            reason: 'Wooting’s own SDK and Wootility send this read to this exact identity',
          }
        : { auto: false, reason: 'not a listed Wooting keyboard' },
  },
  match(group): CandidateMatch {
    const model = wootingModel(group.identity.vendorId, group.identity.productId);
    const ch = findChannel(group);
    if (!model)
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['not a listed Wooting keyboard'],
      };
    if (!ch)
      return {
        applicable: false,
        score: 0,
        reasons: [model.name],
        rejections: ['no 1337/FF55 configuration collection'],
      };
    return {
      applicable: true,
      score: 85,
      reasons: [model.name, `configuration collection ${ch.v3 ? 'FF55 (v3)' : '1337 (v2)'}`],
      rejections: [],
    };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const model = wootingModel(ctx.group.identity.vendorId, ctx.group.identity.productId);
    const ch = findChannel(ctx.group);
    if (ctx.level !== 'handshake' || !model || !ch)
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
        summary: 'Descriptor signature only.',
        steps: [],
        facts: {},
      };
    const s = new WootingSession(await ctx.open(ch.iface), ch);
    const r = await s.command(Cmd.DEVICE_CONFIG).catch(() => null);
    const ok = !!r && r.length >= 20;
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.VERIFIED : Evidence.HYPOTHESIS,
      summary: ok
        ? `${model.name} answered the device-config read`
        : 'No answer to the device-config read',
      steps: [
        {
          name: 'DEVICE_CONFIG (19)',
          status: ok ? 'pass' : 'fail',
          detail: ok ? `${r!.length}-byte answer` : 'no answer',
        },
      ],
      facts: ok ? { model: model.name } : {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const model = wootingModel(group.identity.vendorId, group.identity.productId);
    const ch = findChannel(group);
    if (!model || !ch) throw new Error('Not a Wooting keyboard');
    return new WootingDriver(group, ch, model, {
      store: opts.store,
      open: async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
    });
  },
};

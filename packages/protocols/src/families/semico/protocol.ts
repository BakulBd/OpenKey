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
  RgbConfig,
  StateStore,
  TransportMode,
} from '@openkey/core';
import { getLayout } from '@openkey/devices';
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
 * SEMICO keyboard firmware of the wired single-colour AJAZZ AK992 (USB 1A2C:9C00, manufacturer
 * "SEMICO"). Facts from J0hnBloodborne/rea-jazz (MIT; FINDINGS.md, ak992.py), traced from the vendor
 * app and the firmware's command parser and tested on the keyboard by the source:
 *
 * - one feature report, ID 0x07, 7 data bytes, on vendor collection FF01:0001;
 * - lighting: `FF FF <mode-1> <brightness-1> <speed-1> 00 <direction>`, modes 1–20, levels 1–5;
 * - the firmware stores the mode in an EEPROM, so OpenKey sends at most one mode change a second;
 * - `EE …` sets the firmware-update flag and is never sent; nothing can be read back.
 */
export const SEMICO_PROTOCOL_ID = 'semico-lighting';
export const REPORT_ID = 0x07;
export const REPORT_BYTES = 7;
export const MODELS: readonly { vendorId: number; productId: number; model: string }[] = [
  { vendorId: 0x1a2c, productId: 0x9c00, model: 'AJAZZ AK992 (wired, single colour)' },
];
/** Prefixes OpenKey never sends: the firmware-update flag. */
const FORBIDDEN = [0xee];
export const MIN_MODE_INTERVAL_MS = 1000;

/** Modes of the vendor layout (layouts/KB-K102.xml) with the vendor's names. */
export const MODES: readonly [number, string][] = [
  [1, 'Steady'],
  [2, 'Custom (recorded with Fn on the keyboard)'],
  [3, 'Breathing'],
  [4, 'Windmill'],
  [5, 'Neon stream'],
  [6, 'Streamer'],
  [7, 'Flowing light and colour'],
  [8, 'Dripping ripples'],
  [9, 'Brilliant point'],
  [10, 'Flash away'],
  [11, 'Shadow disappear'],
  [12, 'Ripples shining'],
  [13, 'Rich and honored'],
  [14, 'Marquee'],
  [15, 'Rotating storm'],
  [16, 'Serpentine horse race'],
  [17, 'Stars twinkle'],
  [18, 'Retro snake'],
  [19, 'Diagonal transformation'],
  [20, 'Sine wave'],
];

const isChannel = (c: HidCollection) =>
  c.usagePage === 0xff01 &&
  c.featureReports.some((r) => r.reportId === REPORT_ID && r.size === REPORT_BYTES);
const channel = (g: { interfaces: HidInterfaceInfo[] }) =>
  g.interfaces.find((i) => i.collections.some(isChannel));
const modelOf = (g: HidDeviceGroup) =>
  MODELS.find((m) => m.vendorId === g.identity.vendorId && m.productId === g.identity.productId);

/** The mode packet (without the report ID). */
export function modePacket(mode: number, brightness: number, speed: number): Uint8Array {
  if (!MODES.some(([m]) => m === mode))
    throw new ProtocolError(`Mode ${mode} is not one of the keyboard’s modes.`);
  const lvl = (n: number) => Math.max(1, Math.min(5, Math.round(n)));
  const p = Uint8Array.of(0xff, 0xff, mode - 1, lvl(brightness) - 1, lvl(speed) - 1, 0x00, 0x00);
  if (FORBIDDEN.includes(p[0]!)) throw new ProtocolError('Refusing a firmware-update command.');
  return p;
}

export class SemicoDriver extends BaseKeyboardDriver {
  readonly protocolId = SEMICO_PROTOCOL_ID;
  readonly transport: TransportMode;
  private t: HidTransport | null = null;
  private lastWrite = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    readonly model: string,
    private readonly opts: {
      store: StateStore;
      open: (i: HidInterfaceInfo) => Promise<HidTransport>;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    super();
    this.transport = group.transportHint;
  }

  private get key(): string {
    return `semico/${this.group.identity.productId.toString(16)}`;
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
    return getLayout('ak820-pro');
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.OBSERVED,
      source: 'USB identity in the vendor configuration',
    });
    c.rgb = configurable('mirror', true, Evidence.INFERRED, {
      safety: SafetyLevel.CAUTION,
      source: 'J0hnBloodborne/rea-jazz (tested on the keyboard by the source)',
      value: '19 built-in effects and the Fn-recorded preset, brightness and speed 1–5',
      note: 'The keyboard cannot report its lighting; OpenKey shows what it last wrote. One change a second at most (the mode is saved to the keyboard’s memory).',
    });
    c.perKeyRgb = feature(FeatureStatus.NOT_SUPPORTED, {
      confidence: Evidence.OBSERVED,
      note: 'Single-colour backlight; per-key commands were tested by the source with no effect.',
    });
    c.keymap = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
      confidence: Evidence.INFERRED,
      note: 'The key-map upload is traced in the vendor app but not tested; OpenKey does not send it.',
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
      protocol: { id: this.protocolId, name: 'SEMICO keyboard firmware (feature report 7)' },
      battery: null,
      fields: [],
    };
  }

  override getRgbEffects(): EffectCatalog {
    return {
      effects: MODES.map(([id, name]) => ({
        id,
        name,
        controls: {
          color: false,
          colorful: false,
          brightness: true,
          speed: id !== 1 && id !== 2,
          direction: [],
        },
      })),
      brightness: { min: 1, max: 5 },
      speed: { min: 1, max: 5 },
      customEffect: 2,
    };
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    return (
      (await this.opts.store.get<RgbConfig>(this.key)) ?? {
        effect: 5,
        color: { r: 255, g: 255, b: 255 },
        colorful: false,
        brightness: 5,
        speed: 4,
        direction: 'right',
      }
    );
  }

  override async setRgbConfig(c: RgbConfig): Promise<void> {
    if (!this.t) throw new ProtocolError('Not connected');
    const packet = modePacket(c.effect, c.brightness, c.speed);
    const wait = this.lastWrite + MIN_MODE_INTERVAL_MS - Date.now();
    if (wait > 0) await (this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
    await this.t.sendFeatureReport(REPORT_ID, packet);
    this.lastWrite = Date.now();
    await this.opts.store.set(this.key, c);
  }
}

export const semicoProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: SEMICO_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb'], configuration: ['usb'] },
    verification:
      'Lighting packet traced from the vendor app and the firmware parser, and tested on an AK992 by the source. Not yet run by OpenKey.',
    safety:
      'Write-only protocol: identification is the vendor’s own model list plus the exact report layout, and nothing is sent while detecting. Only the lighting command is ever sent, at most once a second; the firmware-update command is refused.',
    provenance: [
      {
        source: 'public-reverse-engineering',
        reference: 'J0hnBloodborne/rea-jazz FINDINGS.md and ak992.py (MIT)',
        status: Evidence.INFERRED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Built-in effects, brightness and speed only; the AK992 backlight is single-colour.',
      'The keyboard cannot report its settings; OpenKey shows what it last wrote.',
      'The 2.4 GHz and RGB AK992 versions use another command header and are not covered.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'SEMICO keyboard firmware (AJAZZ AK992)',
  family: SEMICO_PROTOCOL_ID,
  priority: 42,
  supportedDevices: 'AJAZZ AK992 wired single-colour (1A2C:9C00)',
  supportedFirmware: 'SEMICO firmware 700N (device 0x0116)',
  requiredUsagePages: [0xff01],
  requiredReports: ['FF01 feature id 7 7B'],
  evidence: ['J0hnBloodborne/rea-jazz'],
  probePlan: {
    operations: [],
    autoConsent: (g) =>
      MODELS.some((m) => m.vendorId === g.identity.vendorId && m.productId === g.identity.productId)
        ? {
            auto: true,
            reason: 'no packet is sent: the model is identified from the vendor’s model list',
          }
        : { auto: false, reason: 'not in the vendor’s model list' },
    identifiedBy: 'vendor-model-list',
  },
  match(group): CandidateMatch {
    const ch = channel(group);
    const model = modelOf(group);
    if (!ch)
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['no FF01 feature report 7 of 7 bytes'],
      };
    if (!model)
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['USB ID not in the vendor’s model list'],
      };
    return {
      applicable: true,
      score: 60,
      reasons: ['FF01 feature report 7 (7 B)', `${model.model} in the vendor configuration`],
      rejections: [],
    };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const model = modelOf(ctx.group);
    const ok = !!model && !!channel(ctx.group);
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.INFERRED : Evidence.HYPOTHESIS,
      summary: ok
        ? `${model!.model}: identified from the vendor’s model list (this protocol has no read command)`
        : 'Not a SEMICO keyboard',
      steps: [
        {
          name: 'model list',
          status: ok ? 'pass' : 'fail',
          detail: ok ? model!.model : 'not listed',
        },
      ],
      facts: ok ? { model: model!.model } : {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const ch = channel(group);
    const model = modelOf(group);
    if (!ch || !model) throw new Error('Not a SEMICO keyboard');
    return new SemicoDriver(group, ch, model.model, {
      store: opts.store,
      open: async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    });
  },
};

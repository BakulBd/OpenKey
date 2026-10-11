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
import type { Capabilities, DeviceInfo, EffectCatalog, KeyboardLayout, RgbConfig, SettingsSchema, StateStore, SystemSettings, TransportMode } from '@openkey/core';
import { getLayout } from '@openkey/devices';
import { LoggingTransport } from '@openkey/hid';
import type { HidCollection, HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import type { CandidateMatch, ProbeContext, ProbeResult, ProtocolDefinition } from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';
import { rkClassicModel } from './models.js';

/**
 * The classic RK (Royal Kludge) protocol: one 65-byte feature report, ID 0x0A, on the board's
 * Generic Desktop / System Control collection. Facts from rnayabed/rangoli
 * (keyboardconfiguratorcontroller.cpp, modemodel.h; GPL-3.0, facts only) and vinc3m1/kludgeknight
 * docs/lighting-protocol.md (GPL-3.0, facts only).
 *
 * The protocol has no read command: the keyboard cannot report its settings, so OpenKey mirrors
 * what it last wrote, and identification is the model list of RK's own software plus the exact report
 * layout. Only the lighting/sleep packet is sent; key maps need a per-model key table and are not.
 */
export const RK_CLASSIC_PROTOCOL_ID = 'rk-classic';
export const RK_VID = 0x258a;
export const REPORT_ID = 0x0a;
export const REPORT_BYTES = 64;

/** Effect numbers, RGB boards (RK `tc_led_mode1…21`; Rangoli `RGBModes`). */
const RGB_EFFECTS: readonly [number, string][] = [
  [1, 'Neon stream'], [2, 'Ripples shining'], [3, 'Rotating windmill'], [4, 'Sine wave'], [5, 'Rainbow roulette'],
  [6, 'Stars twinkle'], [7, 'Layer upon layer'], [8, 'Rich and honored'], [9, 'Marquee effect'], [10, 'Rotating storm'],
  [11, 'Serpentine horse race'], [12, 'Retro snake'], [13, 'Diagonal transformation'], [15, 'Ambilight'], [16, 'Streamer'],
  [17, 'Steady'], [18, 'Breathing'], [19, 'Neon'], [20, 'Shadow disappear'], [21, 'Flash away'],
];
/** Effect numbers, single-colour boards (Rangoli `Modes`). */
const SINGLE_EFFECTS: readonly [number, string][] = [
  [1, 'Steady'], [3, 'Breathing'], [4, 'Press and destroy'], [5, 'Neon stream'], [6, 'Streamer'], [7, 'Ambilight'],
  [8, 'Dripping ripples'], [9, 'Brilliant point'], [10, 'Flash away'], [11, 'Shadow disappear'], [12, 'Ripples shining'],
  [13, 'Rich and honored'], [14, 'Marquee effect'], [15, 'Rotating storm'], [16, 'Serpentine horse race'], [17, 'Stars twinkle'],
  [18, 'Retro snake'], [19, 'Diagonal transformation'], [20, 'Sine wave'],
];
/** Sleep timer values: 1 = 5 min, 2 = 10 min, 3 = 20 min, 4 = 30 min, 5 = never. */
const SLEEP = [
  { value: 1, label: '5 min' },
  { value: 2, label: '10 min' },
  { value: 3, label: '20 min' },
  { value: 4, label: '30 min' },
  { value: 5, label: 'Never' },
];

const isChannel = (c: HidCollection) => c.featureReports.some((r) => r.reportId === REPORT_ID && r.size === REPORT_BYTES);
export const findChannel = (g: HidDeviceGroup): HidInterfaceInfo | undefined => g.interfaces.find((i) => i.collections.some(isChannel));

/** The lighting packet, without the report ID: `01 01 02 29 mode 00 speed brightness R G B random sleep`. */
export function lightingPacket(c: { effect: number; speed: number; brightness: number; color: { r: number; g: number; b: number }; colorful: boolean; sleep: number }): Uint8Array {
  const p = new Uint8Array(REPORT_BYTES);
  p.set([0x01, 0x01, 0x02, 0x29, c.effect, 0x00, c.speed, c.brightness]);
  if (!c.colorful) p.set([c.color.r, c.color.g, c.color.b], 8);
  p[11] = c.colorful ? 1 : 0;
  p[12] = c.sleep;
  return p;
}

interface Mirror {
  rgb: RgbConfig;
  sleep: number;
}

export class RkClassicDriver extends BaseKeyboardDriver {
  readonly protocolId = RK_CLASSIC_PROTOCOL_ID;
  readonly transport: TransportMode;
  private t: HidTransport | null = null;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    readonly model: { name: string; rgb: boolean },
    private readonly opts: { store: StateStore; open: (i: HidInterfaceInfo) => Promise<HidTransport> },
  ) {
    super();
    this.transport = group.transportHint;
  }

  private get key(): string {
    return `rk-classic/${this.group.identity.productId.toString(16).padStart(4, '0')}`;
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

  private effects(): readonly [number, string][] {
    return this.model.rgb ? RGB_EFFECTS : SINGLE_EFFECTS;
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, { read: 'device', confidence: Evidence.OBSERVED, source: 'USB identity in RK’s model list' });
    const usb = this.transport === 'usb';
    const note = 'The keyboard cannot report its lighting; OpenKey shows what it last wrote.';
    c.rgb = usb
      ? configurable('mirror', true, Evidence.INFERRED, { safety: SafetyLevel.CAUTION, note, source: 'rangoli / kludgeknight (community-tested)' })
      : feature(FeatureStatus.TRANSPORT_LIMITED, { confidence: Evidence.INFERRED, note: 'Connect the keyboard by USB cable to change settings.' });
    c.sleep = usb ? configurable('mirror', true, Evidence.INFERRED, { safety: SafetyLevel.CAUTION, note: 'Sent with the lighting packet.' }) : feature(FeatureStatus.TRANSPORT_LIMITED, { confidence: Evidence.INFERRED });
    c.keymap = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, { confidence: Evidence.INFERRED, note: 'RK key maps are written as a whole table that needs the model’s key list; not included yet.' });
    c.perKeyRgb = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, { confidence: Evidence.INFERRED, note: 'Needs the model’s LED index list.' });
    c.macros = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, { confidence: Evidence.UNKNOWN, note: 'The RK macro protocol is not documented by any open project.' });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      model: `RK ${this.model.name}`,
      profileId: this.key.replace('/', '-'),
      identity: this.group.identity,
      firmware: { version: null, source: 'not reported by this protocol', confidence: Evidence.UNKNOWN },
      transport: this.transport,
      protocol: { id: this.protocolId, name: 'Classic RK protocol (feature report 0x0A)' },
      battery: null,
      fields: [{ key: 'effects', label: 'Effect table', value: this.model.rgb ? 'RGB' : 'single colour', confidence: Evidence.INFERRED, source: 'rangoli model config' }],
    };
  }

  override getRgbEffects(): EffectCatalog {
    return {
      effects: this.effects().map(([id, name]) => ({ id, name, controls: { color: this.model.rgb, colorful: this.model.rgb, brightness: true, speed: name !== 'Steady', direction: [] } })),
      brightness: { min: 1, max: 5 },
      speed: { min: 1, max: 5 },
    };
  }

  private async mirror(): Promise<Mirror> {
    return (
      (await this.opts.store.get<Mirror>(this.key)) ?? {
        rgb: { effect: this.model.rgb ? 17 : 1, brightness: 5, speed: 3, color: { r: 255, g: 255, b: 255 }, colorful: false, direction: 'right' },
        sleep: 5,
      }
    );
  }

  private async send(m: Mirror): Promise<void> {
    if (!this.t) throw new ProtocolError('Not connected');
    if (!this.effects().some(([id]) => id === m.rgb.effect)) throw new ProtocolError(`Effect ${m.rgb.effect} is not in this model’s list.`);
    const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));
    await this.t.sendFeatureReport(REPORT_ID, lightingPacket({ ...m.rgb, speed: clamp(m.rgb.speed), brightness: clamp(m.rgb.brightness), sleep: m.sleep }));
    await this.opts.store.set(this.key, m);
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    return (await this.mirror()).rgb;
  }

  override async setRgbConfig(config: RgbConfig): Promise<void> {
    await this.send({ ...(await this.mirror()), rgb: config });
  }

  override getSettingsSchema(): SettingsSchema {
    return { sleepTime: SLEEP };
  }

  override async getSystemSettings(): Promise<SystemSettings> {
    return { sleepTime: (await this.mirror()).sleep };
  }

  override async setSystemSettings(s: SystemSettings): Promise<void> {
    if (s.sleepTime === undefined) return;
    if (!SLEEP.some((o) => o.value === s.sleepTime)) throw new ProtocolError(`Sleep value ${s.sleepTime} is not offered.`);
    await this.send({ ...(await this.mirror()), sleep: s.sleepTime });
  }
}

export const rkClassicProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: RK_CLASSIC_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb', '2.4ghz', 'bluetooth'], configuration: ['usb'] },
    verification: 'Lighting and sleep packet from rangoli and kludgeknight, reported working by their users on the listed models. Not yet run by OpenKey.',
    safety:
      'Write-only protocol with no read command: identification is RK’s own model list plus the exact report layout, nothing is sent while detecting, and every write is an experimental, confirmed lighting/sleep packet. Key maps are not written.',
    provenance: [
      { source: 'public-reverse-engineering', reference: 'github.com/rnayabed/rangoli (GPL-3.0; facts only): packet layout, effect numbering, community-tested model list', status: Evidence.INFERRED },
      { source: 'public-reverse-engineering', reference: 'github.com/vinc3m1/kludgeknight docs/lighting-protocol.md (GPL-3.0; facts only)', status: Evidence.INFERRED },
    ],
    license: 'MIT',
    limitations: [
      'Lighting effect, colour, brightness, speed and sleep only; key maps and per-key colours need per-model key tables.',
      'The keyboard cannot report its settings; OpenKey shows what it last wrote.',
      'Only models on RK’s list are recognised; newer RK boards that use RK’s web software (and the R75 RGB, BY Tech) are other protocols.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'Classic RK protocol (Royal Kludge RK61, RK68, RK84, RK87, RK100 …)',
  family: RK_CLASSIC_PROTOCOL_ID,
  priority: 42,
  supportedDevices: '78 Royal Kludge models from RK’s own model list (VID 258A)',
  supportedFirmware: 'RK factory firmware with the 0x0A feature report',
  requiredUsagePages: [0x0001],
  requiredReports: ['feature id 0x0A 64B'],
  evidence: ['rnayabed/rangoli', 'vinc3m1/kludgeknight'],
  probePlan: {
    operations: [],
    autoConsent: (g) =>
      g.identity.vendorId === RK_VID && rkClassicModel(g.identity.productId)
        ? { auto: true, reason: 'no packet is sent: the model is identified from RK’s own model list' }
        : { auto: false, reason: 'not in RK’s model list' },
    identifiedBy: 'vendor-model-list',
  },
  match(group): CandidateMatch {
    const ch = findChannel(group);
    const model = group.identity.vendorId === RK_VID ? rkClassicModel(group.identity.productId) : undefined;
    if (!ch) return { applicable: false, score: 0, reasons: [], rejections: ['no feature report 0x0A of 64 bytes'] };
    if (!model) return { applicable: false, score: 0, reasons: [], rejections: ['USB ID not in RK’s model list'] };
    return { applicable: true, score: 60, reasons: [`feature report 0x0A (64 B)`, `258A:${group.identity.productId.toString(16).toUpperCase().padStart(4, '0')} is "${model.name}" in RK’s model list`], rejections: [] };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const model = rkClassicModel(ctx.group.identity.productId);
    const ok = !!model && ctx.group.identity.vendorId === RK_VID && !!findChannel(ctx.group);
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.INFERRED : Evidence.HYPOTHESIS,
      summary: ok ? `RK ${model!.name}: identified from RK’s model list (this protocol has no read command)` : 'Not an RK classic model',
      steps: [{ name: 'model list', status: ok ? 'pass' : 'fail', detail: ok ? model!.name : 'not listed' }],
      facts: ok ? { model: model!.name, rgb: model!.rgb } : {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const ch = findChannel(group);
    const model = rkClassicModel(group.identity.productId);
    if (!ch || !model) throw new Error('Not an RK classic keyboard');
    return new RkClassicDriver(group, ch, model, { store: opts.store, open: async (i) => new LoggingTransport(await group.openInterface(i), opts.log) });
  },
};

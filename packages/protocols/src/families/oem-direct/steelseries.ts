import { Evidence, TimeoutError } from '@openkey/core';
import type { Rgb } from '@openkey/core';
import { ansiKeys } from '@openkey/devices';
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
import { DirectLightingDriver } from '../common/direct-lighting.js';
import type { DirectSpec } from '../common/direct-lighting.js';

/**
 * SteelSeries Apex keyboards (Apex 5/7/9, Apex Pro family): direct per-key colours addressed by HID
 * keyboard usage. Facts from OpenRGB Controllers/SteelSeriesController (GPL-2.0; facts only):
 *
 * - 64-byte output reports for commands (0x90 firmware read, 0x3B/0x41 back to on-board lighting,
 *   0x4B initialise on generation 3), answered by 64-byte input reports;
 * - direct frames as one feature report (642 bytes; 512 on the Apex 9): `id count (usage R G B)…`,
 *   id 0x3A (generation 1) or 0x40 / 0x61 wireless (generations 2–3);
 * - the generation is per model, and for the Apex Pro TKL and Apex 9 by firmware (≥ 1.19.7 is 3).
 */
export const STEELSERIES_PROTOCOL_ID = 'steelseries-apex';
const VID = 0x1038;

interface Model {
  pid: number;
  name: string;
  gen: 1 | 2 | 3;
  wireless?: boolean;
  /** Generation decided by the firmware version (Apex Pro TKL, Apex 9). */
  byFirmware?: boolean;
  frame?: number;
}

const MODELS: readonly Model[] = [
  { pid: 0x161c, name: 'Apex 5', gen: 1 },
  { pid: 0x1612, name: 'Apex 7', gen: 1 },
  { pid: 0x1618, name: 'Apex 7 TKL', gen: 1 },
  { pid: 0x1634, name: 'Apex 9 TKL', gen: 2, byFirmware: true, frame: 512 },
  { pid: 0x1620, name: 'Apex 9 Mini', gen: 2, byFirmware: true, frame: 512 },
  { pid: 0x1610, name: 'Apex Pro', gen: 1 },
  { pid: 0x1614, name: 'Apex Pro TKL', gen: 1, byFirmware: true },
  { pid: 0x1628, name: 'Apex Pro TKL (2023)', gen: 2 },
  { pid: 0x1630, name: 'Apex Pro TKL (2023, wireless)', gen: 3, wireless: true },
  { pid: 0x1632, name: 'Apex Pro TKL (2023, wireless)', gen: 3, wireless: true },
  { pid: 0x1642, name: 'Apex Pro TKL Gen 3', gen: 3 },
  { pid: 0x1644, name: 'Apex Pro TKL Gen 3 (wireless)', gen: 3, wireless: true },
  { pid: 0x1646, name: 'Apex Pro TKL Gen 3 (wireless)', gen: 3, wireless: true },
  { pid: 0x1640, name: 'Apex Pro 3', gen: 1 },
];

export const steelSeriesModel = (vid: number, pid: number) =>
  vid === VID ? MODELS.find((m) => m.pid === pid) : undefined;

/** Key codes in LED order (HID keyboard usages; 0xF0 is Fn, 0xFB the logo). */
const KEYS = [
  0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13,
  0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23,
  0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x32, 0x33, 0x34,
  0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x43, 0x44,
  0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x52, 0x64, 0xe0,
  0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xf0, 0x31, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x53, 0x54,
  0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f, 0x60, 0x61, 0x62, 0x63, 0xfb,
];
const BY_USAGE = new Map(
  ansiKeys('full', 'fn').map((k) => [k.usage === 0 ? 0xf0 : k.usage, k.name]),
);
const LEDS = KEYS.map((u) => BY_USAGE.get(u) ?? '');

const Cmd = { FIRMWARE: 0x90, ONBOARD_GEN1: 0x3b, ONBOARD_NEW: 0x41, INIT_GEN3: 0x4b } as const;

/** Generation 3 from firmware 1.19.7 on (models whose generation depends on firmware). */
export function generation(m: Model, firmware: string | null): 1 | 2 | 3 {
  if (!m.byFirmware || !firmware) return m.gen;
  const [maj = 0, min = 0, patch = 0] = firmware.split('.').map(Number);
  if (maj > 1 || (maj === 1 && (min > 19 || (min === 19 && patch >= 7)))) return 3;
  return m.gen;
}

export function parseFirmware(r: Uint8Array): string | null {
  const text = String.fromCharCode(...r.subarray(r[0] === Cmd.FIRMWARE ? 1 : 0)).replace(
    /[^\x20-\x7e]/g,
    '',
  );
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

async function command(t: HidTransport, cmd: number, reply: boolean): Promise<Uint8Array | null> {
  t.drainInput();
  const p = new Uint8Array(64);
  p[0] = cmd;
  await t.sendOutputReport(0, p);
  if (!reply) return null;
  const r = await t.readInputReport(100);
  if (!r) throw new TimeoutError('The keyboard did not answer.');
  return r;
}

export class SteelSeriesApexDriver extends DirectLightingDriver {
  firmware: string | null = null;
  gen: 1 | 2 | 3 = 1;

  constructor(
    group: HidDeviceGroup,
    iface: HidInterfaceInfo,
    readonly model: Model,
    spec: DirectSpec,
    opts: ConstructorParameters<typeof DirectLightingDriver>[3],
  ) {
    super(group, iface, spec, opts);
  }

  override async connect(): Promise<void> {
    await super.connect();
    this.firmware = parseFirmware((await command(this.tr(), Cmd.FIRMWARE, true))!);
    this.gen = generation(this.model, this.firmware);
  }

  protected async takeControl(): Promise<void> {
    if (this.gen >= 3) await command(this.tr(), Cmd.INIT_GEN3, false);
  }

  protected override async releaseControl(): Promise<void> {
    await command(this.tr(), this.gen >= 3 ? Cmd.ONBOARD_NEW : Cmd.ONBOARD_GEN1, false);
  }

  protected async sendFrame(frame: Rgb[]): Promise<void> {
    const size = this.model.frame ?? 642;
    const n = Math.min(KEYS.length, Math.floor((size - 2) / 4));
    const id = this.gen === 1 ? 0x3a : this.model.wireless ? 0x61 : 0x40;
    const p = new Uint8Array(size);
    p[0] = id;
    p[1] = n;
    for (let i = 0; i < n; i++) {
      const c = frame[i] ?? { r: 0, g: 0, b: 0 };
      p.set([KEYS[i]!, c.r, c.g, c.b], 2 + i * 4);
    }
    await this.tr().sendFeatureReport(0, p);
  }
}

const isChannel = (c: HidCollection) =>
  c.featureReports.some((r) => r.reportId === 0 && (r.size === 642 || r.size === 512)) &&
  c.outputReports.some((r) => r.reportId === 0 && r.size === 64);
const channel = (g: HidDeviceGroupInfo) => g.interfaces.find((i) => i.collections.some(isChannel));
const REF = 'OpenRGB Controllers/SteelSeriesController (GPL-2.0; facts only)';

export const steelSeriesProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: STEELSERIES_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb', '2.4ghz', 'bluetooth'], configuration: ['usb', '2.4ghz'] },
    verification:
      'Implemented from OpenRGB, whose users run it on these keyboards; tested against a simulator, not yet run by OpenKey.',
    safety:
      'Reads the firmware version first (as SteelSeries GG does), then sends only direct-lighting frames and the command that gives the lighting back to the keyboard. Actuation and profiles are never touched.',
    provenance: [
      { source: 'public-reverse-engineering', reference: REF, status: Evidence.INFERRED },
    ],
    license: 'MIT',
    limitations: [
      'Lighting only (direct mode); actuation, Rapid Trigger, OLED and profiles stay in SteelSeries GG.',
      'Colours are not stored and cannot be read back; OpenKey shows what it last sent.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'SteelSeries Apex keyboards (direct lighting)',
  family: STEELSERIES_PROTOCOL_ID,
  priority: 50,
  supportedDevices: MODELS.map((m) => `SteelSeries ${m.name}`).join(', '),
  supportedFirmware: 'Apex firmware generations 1–3',
  requiredUsagePages: [],
  requiredReports: ['output id 0 64B + feature id 0 642/512B'],
  evidence: [REF],
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'output',
        collection: 'FFC0:0001',
        reportId: 0,
        payloadPrefix: '90',
        purpose: 'Firmware version read: read-only, sent by SteelSeries GG and OpenRGB first.',
        effect: 'none',
        evidence: Evidence.INFERRED,
      },
      {
        level: 'handshake',
        op: 'input-read',
        collection: 'FFC0:0001',
        reportId: 0,
        payloadPrefix: '',
        purpose: 'The answer carries the version as text (major.minor.patch).',
        effect: 'none',
        evidence: Evidence.INFERRED,
      },
    ],
    autoConsent: (g) =>
      steelSeriesModel(g.identity.vendorId, g.identity.productId)
        ? {
            auto: true,
            reason: 'SteelSeries’ own software reads the firmware version of this exact identity',
          }
        : { auto: false, reason: 'not a listed SteelSeries keyboard' },
  },
  match(group): CandidateMatch {
    const m = steelSeriesModel(group.identity.vendorId, group.identity.productId);
    if (!m)
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['not a listed SteelSeries Apex'],
      };
    if (!channel(group))
      return {
        applicable: false,
        score: 0,
        reasons: [m.name],
        rejections: ['no lighting channel (64-byte output + 642/512-byte feature report)'],
      };
    return {
      applicable: true,
      score: 80,
      reasons: [`SteelSeries ${m.name}`, 'lighting channel'],
      rejections: [],
    };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const m = steelSeriesModel(ctx.group.identity.vendorId, ctx.group.identity.productId);
    const ch = channel(ctx.group);
    if (ctx.level !== 'handshake' || !m || !ch)
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
        summary: 'Descriptor signature only.',
        steps: [],
        facts: {},
      };
    const r = await command(await ctx.open(ch), Cmd.FIRMWARE, true).catch(() => null);
    const fw = r ? parseFirmware(r) : null;
    const ok = !!fw;
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.VERIFIED : Evidence.HYPOTHESIS,
      summary: ok ? `SteelSeries ${m.name}, firmware ${fw}` : 'No firmware version in the answer',
      steps: [{ name: 'firmware (90)', status: ok ? 'pass' : 'fail', detail: fw ?? 'no answer' }],
      facts: ok ? { firmware: fw } : {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const m = steelSeriesModel(group.identity.vendorId, group.identity.productId);
    const ch = channel(group);
    if (!m || !ch) throw new Error('Not a listed SteelSeries Apex');
    return new SteelSeriesApexDriver(
      group,
      ch,
      m,
      {
        protocolId: STEELSERIES_PROTOCOL_ID,
        protocolName: 'SteelSeries Apex direct lighting',
        model: `SteelSeries ${m.name}`,
        leds: LEDS,
        size: /TKL|Mini/.test(m.name) ? 'tkl' : 'full',
        rightMods: 'fn',
        source: REF,
        evidence: Evidence.INFERRED,
        canRelease: true,
      },
      {
        store: opts.store,
        open: async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
      },
    );
  },
};

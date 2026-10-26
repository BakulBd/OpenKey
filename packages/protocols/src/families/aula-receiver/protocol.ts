import {
  BaseKeyboardDriver,
  Evidence,
  FeatureStatus,
  ProtocolError,
  emptyCapabilities,
  feature,
  toHex,
} from '@openkey/core';
import type {
  Capabilities,
  DeviceInfo,
  EffectCatalog,
  KeyboardLayout,
  RgbConfig,
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
import { effectCatalog, identityHex, modelFor } from '../by-tech/models.js';
import type { ByTechModel } from '../by-tech/models.js';
import { COLOR_CYCLE, FIRMWARE_COLORS, isValidPage, readSlot } from '../by-tech/page.js';

/**
 * The 2.4 GHz receiver of AULA's BY Tech keyboards (F75, F87, F99 …; USB 3554:FA09). It speaks its
 * own framing: 20-byte output/input reports with report ID 0x13 on vendor collection FF02:0002,
 * `[0x13, cmd, …]`, replies `[0x13, cmd, pages, page, len, data(14), checksum]` where the checksum is
 * the sum of bytes 0..18.
 *
 * Read commands only, each documented by an independent project:
 * - 0x05 identity: the six-byte model code (pradyumnac/aula-f99-controller, MIT; dnviti/aula-x99-pro-driver-linux)
 * - 0x0B firmware and battery (dnviti)
 * - 0x44 lighting/settings page, 128 bytes, multi-page (dnviti)
 *
 * Writes are not implemented: the receiver's write opcodes overlap "apply" and "reset to defaults" in
 * the only source that documents them, and its page offsets disagree with the cable layout verified on
 * an F75. Settings are changed over the USB cable (by-tech adapter).
 */
export const AULA_RECEIVER_ID = 'aula-receiver';
export const REPORT_ID = 0x13;
/** Payload after the report ID. */
export const REPORT_BYTES = 19;
const PAGE_DATA = 14;

export const Cmd = { IDENTITY: 0x05, VERSION: 0x0b, VERSION_REPLY: 0x0a, LED_PAGE: 0x44 } as const;
/** Opcodes OpenKey never sends to the receiver (writes, apply, reset to defaults). */
export const FORBIDDEN: readonly number[] = [0x01, 0x02, 0x03, 0x04, 0x09];

const isChannel = (c: HidCollection) =>
  c.outputReports.some((r) => r.reportId === REPORT_ID && r.size === REPORT_BYTES) &&
  c.inputReports.some((r) => r.reportId === REPORT_ID && r.size === REPORT_BYTES);
export const findChannel = (g: HidDeviceGroup): HidInterfaceInfo | undefined =>
  g.interfaces.find((i) => i.collections.some(isChannel));
/** AULA's own receiver identity, the one the version/battery read (0x0B) is documented for. */
const isAulaIdentity = (g: HidDeviceGroup) => g.identity.vendorId === 0x3554;

/** A request: payload after the report ID, checksum over the whole 20-byte report at the end. */
export function request(cmd: number): Uint8Array {
  if (FORBIDDEN.includes(cmd))
    throw new ProtocolError(
      `Receiver command 0x${cmd.toString(16)} writes or resets the keyboard; OpenKey never sends it.`,
    );
  const p = new Uint8Array(REPORT_BYTES);
  p[0] = cmd;
  p[1] = 0x01;
  p[REPORT_BYTES - 1] =
    (REPORT_ID + p.subarray(0, REPORT_BYTES - 1).reduce((a, b) => a + b, 0)) & 0xff;
  return p;
}

/** A reply is the receiver's only if it has the config length and a correct checksum. */
export function isReply(r: Uint8Array | null, cmd: number): r is Uint8Array {
  if (!r || r.length !== REPORT_BYTES || r[0] !== cmd) return false;
  return (
    ((REPORT_ID + r.subarray(0, REPORT_BYTES - 1).reduce((a, b) => a + b, 0)) & 0xff) ===
    r[REPORT_BYTES - 1]
  );
}

export class AulaReceiverSession {
  constructor(
    readonly transport: HidTransport,
    private readonly timeoutMs = 1000,
  ) {}

  /** Sends one read command and collects its pages (other input reports are skipped). */
  async read(cmd: number, reply = cmd): Promise<Uint8Array[]> {
    this.transport.drainInput();
    await this.transport.sendOutputReport(REPORT_ID, request(cmd));
    const pages: Uint8Array[] = [];
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const r = await this.transport.readInputReport(Math.max(1, deadline - Date.now()));
      if (!r) break;
      if (!isReply(r, reply)) continue;
      pages[r[2]!] = r;
      const total = r[1]!;
      if (pages.filter(Boolean).length >= total) break;
    }
    return pages.filter(Boolean);
  }

  async identity(): Promise<Uint8Array | null> {
    const [p] = await this.read(Cmd.IDENTITY);
    return p && p[3]! >= 6 ? p.slice(4, 10) : null;
  }

  async version(): Promise<{ firmware: number; battery: number | null } | null> {
    const [p] = await this.read(Cmd.VERSION, Cmd.VERSION_REPLY);
    if (!p) return null;
    return { firmware: p[4]!, battery: p[6] === 0x01 ? p[5]! : null };
  }

  async settingsPage(): Promise<Uint8Array | null> {
    const pages = await this.read(Cmd.LED_PAGE);
    if (!pages.length) return null;
    const out: number[] = [];
    for (const p of pages) out.push(...p.subarray(4, 4 + Math.min(PAGE_DATA, p[3]!)));
    return Uint8Array.from(out.slice(0, 128));
  }
}

/** Read-only view of a keyboard through its receiver. */
export class AulaReceiverDriver extends BaseKeyboardDriver {
  readonly protocolId = AULA_RECEIVER_ID;
  readonly transport: TransportMode = '2.4ghz';
  private session: AulaReceiverSession | null = null;
  private version: { firmware: number; battery: number | null } | null = null;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    readonly identity: Uint8Array,
    readonly model: ByTechModel | null,
    private readonly open: (i: HidInterfaceInfo) => Promise<HidTransport>,
  ) {
    super();
  }

  private s(): AulaReceiverSession {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  async connect(): Promise<void> {
    this.session = new AulaReceiverSession(await this.open(this.iface));
    // 0x0B is a version read on AULA keyboards only: RK's L-series receivers share 3554:FA09, and
    // on RK's platform the same byte sets the screen clock. It is sent only when the keyboard's
    // model code (0x05, a read) is a known AULA model.
    this.version = this.versionReadable ? await this.session.version().catch(() => null) : null;
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.transport.close().catch(() => undefined);
  }

  getLayout(): KeyboardLayout {
    return getLayout('ak820-pro');
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.VERIFIED,
      source: 'receiver command 0x05',
    });
    c.battery =
      this.version?.battery !== null && this.version
        ? feature(FeatureStatus.READ_ONLY, {
            read: 'device',
            confidence: Evidence.INFERRED,
            source: 'receiver command 0x0B (one source)',
          })
        : feature(FeatureStatus.UNKNOWN, { confidence: Evidence.UNKNOWN });
    const cable =
      'Settings are changed over the USB cable; through the receiver OpenKey only reads.';
    c.rgb = this.model?.pageLayout
      ? feature(FeatureStatus.READ_ONLY, {
          read: 'device',
          confidence: Evidence.INFERRED,
          note: cable,
          source: 'receiver command 0x44, cable page layout',
        })
      : feature(FeatureStatus.TRANSPORT_LIMITED, { confidence: Evidence.INFERRED, note: cable });
    for (const f of ['keymap', 'fnLayer', 'macros', 'sleep', 'perKeyRgb'] as const)
      c[f] = feature(FeatureStatus.TRANSPORT_LIMITED, {
        confidence: Evidence.INFERRED,
        note: cable,
      });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const name = this.model ? `${this.model.brand} ${this.model.model}` : 'AULA keyboard';
    return {
      model: `${name} (2.4 GHz receiver)`,
      profileId: 'aula-receiver',
      identity: this.group.identity,
      firmware: {
        version: this.version ? String(this.version.firmware) : null,
        source: 'receiver command 0x0B',
        confidence: this.version ? Evidence.INFERRED : Evidence.UNKNOWN,
      },
      transport: this.transport,
      protocol: { id: this.protocolId, name: 'AULA receiver protocol (report 0x13)' },
      battery:
        this.version?.battery != null ? { level: this.version.battery, charging: false } : null,
      fields: [
        {
          key: 'modelCode',
          label: 'Model code',
          value: identityHex(this.identity),
          confidence: Evidence.VERIFIED,
          source: 'receiver command 0x05',
        },
      ],
      raw: { identity: toHex(this.identity) },
    };
  }

  /** AULA's receiver identity and a model code from AULA's own table (see connect). */
  private get versionReadable(): boolean {
    return isAulaIdentity(this.group) && this.model?.brand === 'AULA';
  }

  override async getBattery(): Promise<{ level: number; charging: boolean } | null> {
    if (!this.versionReadable) return null;
    const v = await this.s().version();
    return v?.battery != null ? { level: v.battery, charging: false } : null;
  }

  override getRgbEffects(): EffectCatalog {
    if (!this.model?.effects) throw new ProtocolError('Effect list unknown for this model.');
    return effectCatalog(this.model);
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    const layout = this.model?.pageLayout;
    if (!layout) throw new ProtocolError('The settings layout of this model is not known.');
    const page = await this.s().settingsPage();
    if (!page || !isValidPage(page))
      throw new ProtocolError('The receiver did not return a complete settings page.');
    const effect = page[layout.effect]!;
    const slot = readSlot(page, layout, effect) ?? { brightness: 0, speed: 0, color: 0 };
    const c = FIRMWARE_COLORS[slot.color] ?? FIRMWARE_COLORS[6]!;
    return {
      effect,
      brightness: slot.brightness,
      speed: slot.speed,
      colorful: slot.color === COLOR_CYCLE,
      color: { r: c[1], g: c[2], b: c[3] },
      direction: 'right',
    };
  }
}

export const aulaReceiverProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: AULA_RECEIVER_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['2.4ghz'], configuration: [] },
    verification:
      'Read commands documented by two independent projects (identity by both); not yet run by OpenKey on a receiver.',
    safety:
      'Read-only: identity, version/battery and the settings page. Write, apply and reset opcodes are refused by the request builder.',
    provenance: [
      {
        source: 'public-reverse-engineering',
        reference:
          'github.com/pradyumnac/aula-f99-controller docs/reference/f99/protocol.md (MIT): framing, checksum, model query 0x05',
        status: Evidence.INFERRED,
      },
      {
        source: 'public-reverse-engineering',
        reference:
          'github.com/dnviti/aula-x99-pro-driver-linux PROTOCOL.md (no licence; facts only): multi-page replies, 0x0B, 0x44',
        status: Evidence.INFERRED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Read-only: settings, key maps and lighting are changed over the USB cable.',
      'Battery and firmware come from one source and are shown as unconfirmed.',
      'The F99 Max is not covered by any source and is not assumed to be compatible.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'AULA 2.4 GHz receiver (F75, F87, F99 …, read-only)',
  family: 'by-tech',
  priority: 41,
  supportedDevices: 'AULA receiver 3554:FA09 with an F75, F87 or F99-family keyboard',
  supportedFirmware: 'Receiver protocol with report 0x13',
  requiredUsagePages: [0xff02],
  requiredReports: ['output/input id 0x13 19B'],
  evidence: ['pradyumnac/aula-f99-controller', 'dnviti/aula-x99-pro-driver-linux'],
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'output',
        collection: 'FF02:0002',
        reportId: REPORT_ID,
        payloadPrefix: '05',
        purpose: 'Identity query: the keyboard’s six-byte model code. A read.',
        effect: 'none',
        evidence: Evidence.INFERRED,
      },
      {
        level: 'handshake',
        op: 'input-read',
        collection: 'FF02:0002',
        reportId: REPORT_ID,
        payloadPrefix: '',
        purpose: 'Reply with the model code and a checksum.',
        effect: 'none',
        evidence: Evidence.INFERRED,
      },
    ],
    autoConsent: () => ({
      auto: false,
      reason: 'one read request (identity 0x05); asked first until verified on hardware',
    }),
  },
  match(group): CandidateMatch {
    const ch = findChannel(group);
    if (!ch)
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['no 19-byte report 0x13 in both directions'],
      };
    // RK's receivers use the same framing, but there 0x0B sets the screen clock (rk-m87-receiver).
    if (group.identity.vendorId === 0x258a)
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['RK receiver (258A): its 0x0B command sets the screen clock, not a read'],
      };
    const reasons = ['report 0x13 (19 B) in and out: AULA receiver command channel'];
    let score = 40;
    if (group.identity.vendorId === 0x3554) {
      score += 5;
      reasons.push('vendor ID 3554 (AULA receivers, also used by other brands)');
    }
    return { applicable: true, score, reasons, rejections: [] };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const ch = findChannel(ctx.group);
    if (!ch)
      return {
        status: 'fail',
        confidence: Evidence.HYPOTHESIS,
        summary: 'Channel missing',
        steps: [],
        facts: {},
      };
    if (ctx.level !== 'handshake')
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
        summary: 'Descriptor signature only.',
        steps: [],
        facts: {},
      };
    const id = await new AulaReceiverSession(await ctx.open(ch)).identity().catch(() => null);
    const model = id ? modelFor(id, 0x010c) : undefined;
    const ok = !!id && id.some((b) => b !== 0);
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.OBSERVED : Evidence.HYPOTHESIS,
      summary: ok
        ? `Receiver answered with model code ${identityHex(id!)}${model ? ` (${model.brand} ${model.model})` : ''}`
        : 'No receiver answer (is the keyboard awake and in 2.4 GHz mode?)',
      steps: [
        {
          name: 'identity (05)',
          status: ok ? 'pass' : 'fail',
          detail: ok ? identityHex(id!) : 'no valid reply',
          ...(id ? { raw: toHex(id) } : {}),
        },
      ],
      facts: ok
        ? { identity: identityHex(id!), model: model ? `${model.brand} ${model.model}` : null }
        : {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const ch = findChannel(group);
    if (!ch) throw new Error('AULA receiver channel missing');
    const identity = Uint8Array.from(
      String(opts.probe?.facts.identity ?? '')
        .split(' ')
        .filter(Boolean)
        .map((h) => parseInt(h, 16)),
    );
    return new AulaReceiverDriver(
      group,
      ch,
      identity,
      modelFor(identity, 0x010c) ?? null,
      async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
    );
  },
};

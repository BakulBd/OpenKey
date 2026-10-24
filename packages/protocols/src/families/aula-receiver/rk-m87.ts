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
import type { Capabilities, DeviceInfo, KeyboardLayout, TransportMode } from '@openkey/core';
import { getLayout } from '@openkey/devices';
import { LoggingTransport } from '@openkey/hid';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import type {
  CandidateMatch,
  ProbeContext,
  ProbeResult,
  ProtocolDefinition,
} from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';
import { SCREEN_PARAM_BYTES, screenParams } from '../by-tech/constants.js';
import { REPORT_BYTES, REPORT_ID, findChannel } from './protocol.js';

/**
 * The 2.4 GHz receiver of the RK M87 (USB 258A:0150, "SINOWEALTH Gaming KB"). Facts from
 * ElXreno/rk-m87-sync docs/PROTOCOL.md (MIT), decoded from RK's DeviceDriver.exe (CDev3632) and
 * measured live by the source on an M87 receiver:
 *
 * - report 0x13, 19 bytes after the ID: `cmd, packets, index, (board << 4) | length, data(14), sum`,
 *   where the sum is bytes 0..18 including the report ID;
 * - `07` GetDongleStatus: a read with no side effects; payload byte 1 is 1 while the keyboard is
 *   awake and 0 while it sleeps;
 * - `0B` SetScreenParam: volume, CPU, memory, date and time for the screen; the keyboard answers
 *   with a `0B` reply while it is awake.
 *
 * Nothing else is sent. On this receiver `01`–`04`, `09` and `12` write the keyboard's settings,
 * `06` resets it, and `0C`–`0F` reset or freeze the screen clock (all documented by the source).
 */
export const RK_M87_RECEIVER_ID = 'rk-m87-receiver';
export const RK_VENDOR_ID = 0x258a;
export const RK_M87_RECEIVER_PID = 0x0150;

export const M87Cmd = { DONGLE_STATUS: 0x07, SET_SCREEN_PARAM: 0x0b } as const;
const ALLOWED: readonly number[] = [M87Cmd.DONGLE_STATUS, M87Cmd.SET_SCREEN_PARAM];
const REPLY_MS = 1000;

const sum = (bytes: Uint8Array) => (REPORT_ID + bytes.reduce((a, b) => a + b, 0)) & 0xff;

/** One single-packet request (payload after the report ID). Only `07` and `0B` are built. */
export function m87Packet(cmd: number, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (!ALLOWED.includes(cmd))
    throw new ProtocolError(
      `Receiver command 0x${cmd.toString(16)} changes or resets the keyboard; OpenKey never sends it.`,
    );
  if (data.length > SCREEN_PARAM_BYTES) throw new ProtocolError('Payload longer than 14 bytes.');
  const p = new Uint8Array(REPORT_BYTES);
  p[0] = cmd;
  p[1] = 1;
  p[2] = 0;
  p[3] = data.length & 0x0f;
  p.set(data, 4);
  p[REPORT_BYTES - 1] = sum(p.subarray(0, REPORT_BYTES - 1));
  return p;
}

/**
 * A reply to `cmd`, as the source reads it: the receiver's length and the command byte; with the
 * high bit set the receiver reports an error (the source's CRC error). The source does not check
 * the reply's sum, so OpenKey does not either.
 */
export function m87Reply(r: Uint8Array | null, cmd: number): 'ok' | 'error' | null {
  if (!r || r.length !== REPORT_BYTES) return null;
  if (r[0] === cmd) return 'ok';
  if (r[0] === (cmd | 0x80)) return 'error';
  return null;
}

const isM87Receiver = (g: Pick<HidDeviceGroup, 'identity'>) =>
  g.identity.vendorId === RK_VENDOR_ID && g.identity.productId === RK_M87_RECEIVER_PID;

async function exchange(
  t: HidTransport,
  packet: Uint8Array,
  ms = REPLY_MS,
): Promise<Uint8Array | null> {
  t.drainInput();
  await t.sendOutputReport(REPORT_ID, packet);
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const r = await t.readInputReport(Math.max(1, deadline - Date.now()));
    if (!r) return null;
    const kind = m87Reply(r, packet[0]!);
    if (kind === 'error')
      throw new ProtocolError('The receiver rejected the request (checksum error).');
    if (kind === 'ok') return r;
  }
  return null;
}

/** Link state from a GetDongleStatus reply: true = keyboard awake, false = asleep or away. */
export function linkAwake(r: Uint8Array): boolean {
  return r[4] === 1;
}

export class RkM87ReceiverDriver extends BaseKeyboardDriver {
  readonly protocolId = RK_M87_RECEIVER_ID;
  readonly transport: TransportMode = '2.4ghz';
  private t: HidTransport | null = null;
  private awake: boolean | null = null;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    private readonly open: (i: HidInterfaceInfo) => Promise<HidTransport>,
  ) {
    super();
  }

  private tr(): HidTransport {
    if (!this.t) throw new ProtocolError('Not connected');
    return this.t;
  }

  async connect(): Promise<void> {
    this.t = await this.open(this.iface);
    this.awake = await this.linkState().catch(() => null);
  }

  async disconnect(): Promise<void> {
    const t = this.t;
    this.t = null;
    await t?.close().catch(() => undefined);
  }

  /** Asks the receiver whether the keyboard is awake (GetDongleStatus, a read). */
  async linkState(): Promise<boolean | null> {
    const r = await exchange(this.tr(), m87Packet(M87Cmd.DONGLE_STATUS));
    return r ? linkAwake(r) : null;
  }

  getLayout(): KeyboardLayout {
    return getLayout('ak820-pro');
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.OBSERVED,
      source: 'USB identity 258A:0150 and GetDongleStatus 0x07 (ElXreno/rk-m87-sync, MIT)',
    });
    c.tftClock = configurable('none', true, Evidence.INFERRED, {
      safety: SafetyLevel.SAFE_VOLATILE,
      source:
        'SetScreenParam 0x0B through the receiver (ElXreno/rk-m87-sync, MIT: decoded from RK’s driver and run on an M87 receiver by the source)',
      note: 'The keyboard keeps no time of its own: set it after each connection. A browser cannot read the computer’s volume, so the screen shows 0 for it until RK’s software sends one. Wake the keyboard first (press a key).',
    });
    const cable = 'Through the receiver OpenKey only sets the screen clock; connect the cable.';
    for (const f of ['rgb', 'perKeyRgb', 'keymap', 'fnLayer', 'macros', 'tft'] as const)
      c[f] = feature(FeatureStatus.TRANSPORT_LIMITED, {
        confidence: Evidence.INFERRED,
        note: cable,
      });
    c.factoryDefaults = feature(FeatureStatus.NOT_SUPPORTED, {
      confidence: Evidence.INFERRED,
      note: 'The receiver has a reset command; OpenKey never sends it.',
    });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      model: 'RK M87 (2.4 GHz receiver)',
      profileId: 'rk-m87-receiver',
      identity: this.group.identity,
      firmware: { version: null, source: 'not read', confidence: Evidence.UNKNOWN },
      transport: this.transport,
      protocol: { id: this.protocolId, name: 'RK receiver protocol (report 0x13, CDev3632)' },
      battery: null,
      fields: [
        {
          key: 'link',
          label: 'Keyboard',
          value:
            this.awake === null
              ? 'receiver did not answer'
              : this.awake
                ? 'awake and linked'
                : 'asleep or out of range (press a key)',
          confidence: this.awake === null ? Evidence.UNKNOWN : Evidence.OBSERVED,
          source: 'GetDongleStatus 0x07',
        },
      ],
    };
  }

  override async syncClock(date: Date = new Date()): Promise<void> {
    const t = this.tr();
    const awake = await this.linkState();
    if (awake === false)
      throw new ProtocolError('The keyboard is asleep or out of range: press a key and try again.');
    const r = await exchange(t, m87Packet(M87Cmd.SET_SCREEN_PARAM, screenParams(date)));
    if (!r) throw new ProtocolError('The keyboard did not acknowledge the time (is it awake?).');
    this.awake = true;
  }
}

export const rkM87ReceiverProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: RK_M87_RECEIVER_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['2.4ghz'], configuration: ['2.4ghz'] },
    verification:
      'From ElXreno/rk-m87-sync (MIT), decoded from RK’s driver and run on an M87 receiver by the source; not yet run by OpenKey on hardware.',
    safety:
      'Detection sends nothing: the receiver is identified from its USB identity. On connection one read (GetDongleStatus 0x07). The clock write (SetScreenParam 0x0B) is experimental. The request builder refuses every other command, including the clock-reset (0C–0F), reset (06) and settings writes.',
    provenance: [
      {
        source: 'public-reverse-engineering',
        reference:
          'github.com/ElXreno/rk-m87-sync docs/PROTOCOL.md (MIT): CDev3632 framing, GetDongleStatus 0x07, SetScreenParam 0x0B',
        status: Evidence.INFERRED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Only the screen clock: lighting, keys, macros and pictures are changed over the USB cable.',
      'The time is lost when the keyboard loses power; set it again after each connection.',
      'The computer’s volume cannot be read by a browser; the screen shows 0 for it.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'RK M87 2.4 GHz receiver (screen clock)',
  family: 'by-tech',
  priority: 43,
  supportedDevices: 'RK M87 receiver 258A:0150',
  supportedFirmware: 'Receiver protocol with report 0x13 (CDev3632)',
  requiredUsagePages: [],
  requiredReports: ['output/input id 0x13 19B'],
  evidence: ['ElXreno/rk-m87-sync (MIT)'],
  probePlan: {
    operations: [],
    autoConsent: (g) =>
      isM87Receiver(g)
        ? {
            auto: true,
            reason: 'no packet is sent: the receiver is identified from its USB identity',
          }
        : { auto: false, reason: 'not the RK M87 receiver identity' },
    identifiedBy: 'vendor-model-list',
  },
  match(group): CandidateMatch {
    if (!isM87Receiver(group))
      return { applicable: false, score: 0, reasons: [], rejections: ['not the RK M87 receiver'] };
    if (!findChannel(group))
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['RK M87 receiver without the report 0x13 (19 B) channel'],
      };
    return {
      applicable: true,
      score: 60,
      reasons: ['USB 258A:0150: RK M87 receiver', 'report 0x13 (19 B) in and out'],
      rejections: [],
    };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const ok = isM87Receiver(ctx.group) && !!findChannel(ctx.group);
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.INFERRED : Evidence.HYPOTHESIS,
      summary: ok
        ? 'RK M87 receiver: identified from its USB identity and report layout'
        : 'Not the RK M87 receiver',
      steps: [{ name: 'identity', status: ok ? 'pass' : 'fail', detail: ok ? '258A:0150' : '' }],
      facts: ok ? { model: 'RK M87 receiver' } : {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const ch = findChannel(group);
    if (!ch || !isM87Receiver(group)) throw new Error('Not the RK M87 receiver');
    return new RkM87ReceiverDriver(
      group,
      ch,
      async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
    );
  },
};

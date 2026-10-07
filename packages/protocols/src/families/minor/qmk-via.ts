import { BaseKeyboardDriver, FeatureStatus, Confidence, emptyCapabilities, hex16, toHex } from '@openkey/core';
import type { Capabilities, DeviceInfo, KeyboardLayout, TransportMode } from '@openkey/core';
import { findInterface, maxReportSize } from '@openkey/hid';
import type { HidCollection, HidDeviceGroup } from '@openkey/hid';
import { getLayout } from '@openkey/devices';
import type {
  CandidateMatch,
  ProbeContext,
  ProbeResult,
  ProtocolDefinition,
} from '../../registry.js';

/** QMK raw HID defaults (docs/features/rawhid.md): usage page FF60, usage 61, 32-byte reports. */
const RAW_USAGE_PAGE = 0xff60;
const RAW_USAGE = 0x61;
/** VIA `id_get_protocol_version`: read-only, answered by every VIA-enabled QMK build. */
const VIA_GET_PROTOCOL_VERSION = 0x01;

const isRaw = (c: HidCollection) => c.usagePage === RAW_USAGE_PAGE && c.usage === RAW_USAGE;

class QmkViaDriver extends BaseKeyboardDriver {
  readonly protocolId = 'qmk-via';
  readonly transport: TransportMode;
  constructor(
    private readonly group: HidDeviceGroup,
    private readonly viaVersion: number | null,
  ) {
    super();
    this.transport = group.transportHint;
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  getLayout(): KeyboardLayout {
    return getLayout('ak820-pro');
  }
  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    c.deviceInfo = { status: FeatureStatus.SUPPORTED_READ_ONLY, read: 'device', write: false,
      confidence: Confidence.CONFIRMED,
      note: 'Custom QMK firmware: configure it with VIA/Vial.',
    };
    return c;
  }
  async getDeviceInfo(): Promise<DeviceInfo> {
    const id = this.group.identity;
    return {
      model: 'AJAZZ AK820 (custom QMK firmware)',
      profileId: 'ak820-pro-qmk',
      identity: id,
      firmware: {
        version: this.viaVersion !== null ? `VIA protocol ${hex16(this.viaVersion)}` : null,
        source: 'VIA id_get_protocol_version',
        confidence: Confidence.STRONGLY_SUPPORTED,
      },
      transport: this.transport,
      protocol: { id: this.protocolId, name: 'QMK VIA raw HID' },
      battery: null,
      fields: [],
    };
  }
}

export const qmkViaProtocol: ProtocolDefinition = {
  id: 'qmk-via',
  name: 'QMK / VIA raw HID (custom firmware)',
  family: 'qmk-via',
  priority: 60,
  supportedDevices: 'AK820 boards flashed with community QMK (e.g. fpb/qmk_firmware)',
  supportedFirmware: 'QMK with VIA enabled',
  requiredUsagePages: [RAW_USAGE_PAGE],
  requiredReports: ['FF60:0061 output 32B'],
  evidence: ['QMK raw HID documentation', 'fpb/time-util-ak820pro ak820ctl.c (FF60/0x61)'],
  match(group): CandidateMatch {
    const i = findInterface(group, isRaw);
    // The AK820 2.4 GHz receiver also exposes FF60 (afonsusousa/mrworldwide); leave it to sonix-dongle.
    const dongle =
      /dongle|2\.4g/i.test(group.identity.productName) || group.identity.productId === 0xfdfd;
    return i && !dongle
      ? {
          applicable: true,
          score: 70,
          reasons: ['QMK raw HID collection FF60:0061'],
          rejections: [],
        }
      : {
          applicable: false,
          score: 0,
          reasons: [],
          rejections: [dongle ? 'receiver identity' : 'no FF60:0061 raw HID collection'],
        };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    if (ctx.level !== 'handshake')
      return {
        status: 'skipped',
        confidence: Confidence.INFERRED,
        summary: 'Descriptor signature only.',
        steps: [],
        facts: {},
      };
    const iface = findInterface(ctx.group, isRaw)!;
    const t = await ctx.open(iface);
    const size = maxReportSize(iface.collections[0]!.outputReports) || 32;
    const req = new Uint8Array(size);
    req[0] = VIA_GET_PROTOCOL_VERSION;
    t.drainInput();
    await t.sendOutputReport(0, req);
    const r = await t.readInputReport(500);
    const ok = !!r && r[0] === VIA_GET_PROTOCOL_VERSION;
    const version = ok ? (r[1]! << 8) | r[2]! : null;
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Confidence.CONFIRMED : Confidence.UNVERIFIED,
      summary: ok ? `VIA protocol version ${hex16(version!)}` : 'No VIA answer',
      steps: [
        {
          name: 'VIA id_get_protocol_version',
          status: ok ? 'pass' : 'fail',
          detail: ok ? 'answered' : 'no answer',
          ...(r ? { raw: toHex(r) } : {}),
        },
      ],
      facts: { viaVersion: version },
    };
  },
  async createDriver(group, opts) {
    return new QmkViaDriver(group, (opts.probe?.facts.viaVersion as number | undefined) ?? null);
  },
};

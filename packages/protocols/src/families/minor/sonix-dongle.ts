import { FeatureStatus } from '@openkey/core';
import {
  BaseKeyboardDriver,
  Confidence,
  SafetyBlockedError,
  UnsupportedFeatureError,
  emptyCapabilities,
  clamp,
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
import { LoggingTransport, maxReportSize } from '@openkey/hid';
import type { HidCollection, HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import { getLayout } from '@openkey/devices';
import type {
  CandidateMatch,
  DriverOptions,
  ProbeContext,
  ProbeResult,
  ProtocolDefinition,
} from '../../registry.js';
import { DIRECTION_CODES, effectCatalog } from '../sonix-feature/codecs/lighting.js';

/**
 * 2.4 GHz receiver protocol. Evidence: official driver FUN_0044f5f0 (32-byte output report, byte
 * 31 = additive checksum, response matched on bytes 1–3) and FUN_0042b2a0 (lighting packet
 * 05 10 00 mode R G B … colorful brightness speed direction … AA 55); afonsusousa/mrworldwide
 * capture (ping 20 01 → pong 20 01). Not verified on hardware by OpenKey.
 */
export const DONGLE_REPORT_BYTES = 32;
export const PING = [0x20, 0x01];
/** FUN_00435890: battery percentage is byte 3 of the ping answer (clamped to 100; 0 = unknown). */
export const PING_BATTERY_OFFSET = 3;
/** The official driver re-polls every 15 s (0x3A98 ms). */
export const BATTERY_POLL_MS = 15_000;

export function batteryFromPong(r: Uint8Array): number | null {
  if (r[0] !== PING[0] || r[1] !== PING[1]) return null;
  const v = r[PING_BATTERY_OFFSET] ?? 0;
  return v === 0 ? null : Math.min(100, v);
}

export function dongleChecksum(p: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < DONGLE_REPORT_BYTES - 1; i++) s += p[i]!;
  return s & 0xff;
}

export function donglePacket(bytes: number[]): Uint8Array {
  const p = new Uint8Array(DONGLE_REPORT_BYTES);
  p.set(bytes.slice(0, DONGLE_REPORT_BYTES - 1));
  p[DONGLE_REPORT_BYTES - 1] = dongleChecksum(p);
  return p;
}

export function dongleLightingPacket(c: RgbConfig): Uint8Array {
  const b = new Array(DONGLE_REPORT_BYTES - 1).fill(0);
  b[0] = 0x05;
  b[1] = 0x10;
  b[3] = c.effect & 0xff;
  b[4] = clamp(c.color.r, 0, 255);
  b[5] = clamp(c.color.g, 0, 255);
  b[6] = clamp(c.color.b, 0, 255);
  b[11] = c.colorful ? 1 : 0;
  b[12] = c.brightness;
  b[13] = c.speed;
  b[14] = DIRECTION_CODES[c.direction];
  b[17] = 0xaa;
  b[18] = 0x55;
  return donglePacket(b);
}

const isCommand = (c: HidCollection) =>
  c.usagePage >= 0xff00 &&
  c.usagePage !== 0xffff &&
  maxReportSize(c.outputReports) === DONGLE_REPORT_BYTES;

function isReceiver(group: HidDeviceGroup): boolean {
  const { vendorId, productId, productName } = group.identity;
  return (
    (vendorId === 0x0c45 && productId === 0xfdfd) ||
    (vendorId === 0x05ac && productId === 0x024f) ||
    /2\.4G Dongle/i.test(productName)
  );
}

function commandInterface(group: HidDeviceGroup): HidInterfaceInfo | undefined {
  return group.interfaces.find((i) => i.collections.some(isCommand));
}

class SonixDongleDriver extends BaseKeyboardDriver {
  readonly protocolId = 'sonix-dongle';
  readonly transport: TransportMode = '2.4ghz';
  private t: HidTransport | null = null;
  constructor(
    private readonly group: HidDeviceGroup,
    private readonly opts: DriverOptions,
  ) {
    super();
  }
  async connect(): Promise<void> {
    const i = commandInterface(this.group);
    if (!i)
      throw new UnsupportedFeatureError('configuration', 'receiver command interface not found');
    this.t = new LoggingTransport(await this.group.openInterface(i), this.opts.log);
  }
  async disconnect(): Promise<void> {
    await this.t?.close();
    this.t = null;
  }
  getLayout(): KeyboardLayout {
    return getLayout('ak820-max');
  }
  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    c.deviceInfo = { status: FeatureStatus.SUPPORTED_READ_ONLY, read: 'device', write: false, confidence: Confidence.CONFIRMED };
    c.battery = {
      status: FeatureStatus.SUPPORTED_READ_ONLY,
      read: 'device',
      write: false,
      confidence: Confidence.STRONGLY_SUPPORTED,
      source: 'FUN_00435890: ping 20 01, answer byte 3',
    };
    c.tft = { status: FeatureStatus.NOT_SUPPORTED, read: 'none', write: false, confidence: Confidence.STRONGLY_SUPPORTED, note: 'Official menu_wireless: screen=0' };
    c.rgb = { status: FeatureStatus.CONFIGURABLE, read: 'none', write: true,
      confidence: Confidence.INFERRED,
      note: 'Experimental: official 2.4 GHz lighting packet, not hardware-verified.',
    };
    return c;
  }
  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      model: 'AJAZZ AK820 2.4 GHz receiver',
      profileId: 'ak820-dongle',
      identity: this.group.identity,
      firmware: { version: null, source: 'not exposed', confidence: Confidence.UNVERIFIED },
      transport: '2.4ghz',
      protocol: { id: this.protocolId, name: 'AJAZZ 2.4 GHz receiver protocol (32-byte reports)' },
      battery: null,
      fields: [],
    };
  }
  override getRgbEffects(): EffectCatalog {
    return effectCatalog(5, 5);
  }
  override async getBattery(): Promise<{ level: number; charging: boolean } | null> {
    const t = this.t!;
    t.drainInput();
    await t.sendOutputReport(0, donglePacket(PING));
    for (let i = 0; i < 20; i++) {
      const r = await t.readInputReport(100);
      if (!r) continue;
      const level = batteryFromPong(r);
      if (level !== null) return { level, charging: false };
    }
    return null;
  }

  override async setRgbConfig(config: RgbConfig): Promise<void> {
    if (!this.opts.allowExperimental)
      throw new SafetyBlockedError(
        '2.4 GHz lighting is experimental; enable experimental mode to use it.',
      );
    await this.t!.sendOutputReport(0, dongleLightingPacket(config));
  }
}

export const sonixDongleProtocol: ProtocolDefinition = {
  id: 'sonix-dongle',
  name: 'AJAZZ 2.4 GHz receiver protocol (32-byte output reports + checksum)',
  family: 'sonix-dongle',
  priority: 45,
  supportedDevices: 'AK820 Pro / MAX receivers 0C45:FDFD and 05AC:024F',
  supportedFirmware: 'unknown',
  requiredUsagePages: [],
  requiredReports: ['vendor collection with 32-byte output report'],
  evidence: ['Official AK820 MAX driver FUN_0044f5f0 / FUN_0042b2a0', 'afonsusousa/mrworldwide'],
  match(group): CandidateMatch {
    if (!isReceiver(group))
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['not a known AK820 receiver identity'],
      };
    const i = commandInterface(group);
    return i
      ? {
          applicable: true,
          score: 70,
          reasons: ['known receiver identity', '32-byte vendor command collection'],
          rejections: [],
        }
      : {
          applicable: false,
          score: 0,
          reasons: [],
          rejections: ['receiver without a 32-byte vendor command collection'],
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
    const t = await ctx.open(commandInterface(ctx.group)!);
    t.drainInput();
    await t.sendOutputReport(0, donglePacket(PING));
    const r = await t.readInputReport(500);
    const ok = !!r && r[0] === PING[0] && r[1] === PING[1];
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Confidence.STRONGLY_SUPPORTED : Confidence.UNVERIFIED,
      summary: ok
        ? 'Receiver answered ping (keyboard linked).'
        : 'No ping answer (keyboard asleep or different receiver protocol).',
      steps: [
        {
          name: 'ping 20 01',
          status: ok ? 'pass' : 'fail',
          detail: ok ? 'pong' : 'timeout',
          ...(r ? { raw: toHex(r) } : {}),
        },
      ],
      facts: {},
    };
  },
  async createDriver(group, opts) {
    return new SonixDongleDriver(group, opts);
  },
};

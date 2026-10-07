import { FeatureStatus, SafetyLevel } from '@openkey/core';
import {
  BaseKeyboardDriver,
  Evidence,
  SafetyBlockedError,
  emptyCapabilities,
  clamp,
} from '@openkey/core';
import type {
  Capabilities,
  DeviceInfo,
  EffectCatalog,
  KeyboardLayout,
  PerKeyRgb,
  RgbConfig,
  TransportMode,
} from '@openkey/core';
import { LoggingTransport, findInterface } from '@openkey/hid';
import type { HidDeviceGroup, HidTransport } from '@openkey/hid';
import { getLayout } from '@openkey/devices';
import type {
  CandidateMatch,
  DriverOptions,
  ProbeContext,
  ProbeResult,
  ProtocolDefinition,
} from '../../registry.js';

/**
 * CRS-controller AK820 Max Plus (VID 1A2C). Community evidence only: armoredvortex/ajazz-ak820-max-plus
 * PROTOCOL.md and arafatamim/OpenRGBAK820Plugin. 64-byte reports "AA 55 CC 33 <opcode> …" on FF02.
 * OpenKey never probes it with I/O and keeps every write experimental until verified.
 */
export const CRS_VENDOR_ID = 0x1a2c;
export const CRS_USAGE_PAGE = 0xff02;
const MAGIC = [0xaa, 0x55, 0xcc, 0x33];
export const CrsOp = {
  MODE: 0x07,
  APPLY: 0x09,
  PERSIST: 0x0a,
  BEGIN_EDIT: 0x0b,
  HEARTBEAT: 0x0e,
  FRAME0: 0xf6,
} as const;

export function crsPacket(op: number, payload: number[] = []): Uint8Array {
  const p = new Uint8Array(64);
  p.set([...MAGIC, op, ...payload].slice(0, 64));
  return p;
}

/** Colour indices of the CRS firmware (0 red … 6 white, 7 RGB cycle). */
const CRS_COLORS: [number, number, number][] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

export function nearestCrsColor(c: { r: number; g: number; b: number }, colorful: boolean): number {
  if (colorful) return 7;
  let best = 0;
  let bestD = Infinity;
  CRS_COLORS.forEach(([r, g, b], i) => {
    const d = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

const EFFECT_NAMES = [
  'Horizontal Wave',
  'Chaos',
  'Vertical Wave',
  'Beam',
  'Cycles',
  'Ripples',
  'Static',
  'Breathing',
  'Cross Waves',
  'Dual Wave',
  'Key Glow',
  'Key Ripple',
  'Snake',
  'Spiral',
  'Split Flow',
  'Meteor Shower',
  'Windmill',
  'Sine Wave',
  'Row Sweep',
];

class CrsDriver extends BaseKeyboardDriver {
  readonly protocolId = 'crs-aa55cc33';
  readonly transport: TransportMode;
  private t: HidTransport | null = null;
  constructor(
    private readonly group: HidDeviceGroup,
    private readonly opts: DriverOptions,
  ) {
    super();
    this.transport = group.transportHint;
  }
  async connect(): Promise<void> {
    const i = findInterface(this.group, (c) => c.usagePage === CRS_USAGE_PAGE)!;
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
    c.deviceInfo = { status: FeatureStatus.READ_ONLY, read: 'device', write: false, confidence: Evidence.VERIFIED };
    c.rgb = { status: FeatureStatus.WRITE_ONLY, read: 'none', write: true, safety: SafetyLevel.CAUTION,
      confidence: Evidence.INFERRED,
      note: 'Experimental (community protocol).',
    };
    c.perKeyRgb = { status: FeatureStatus.WRITE_ONLY, read: 'none', write: true, safety: SafetyLevel.CAUTION,
      confidence: Evidence.INFERRED,
      note: 'Experimental (community protocol).',
    };
    return c;
  }
  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      model: 'AJAZZ AK820 Max Plus (CRS controller)',
      profileId: 'ak820-max-crs',
      identity: this.group.identity,
      firmware: { version: null, source: 'not exposed', confidence: Evidence.HYPOTHESIS },
      transport: this.transport,
      protocol: { id: this.protocolId, name: 'CRS AA 55 CC 33 protocol (community)' },
      battery: null,
      fields: [],
    };
  }
  override getRgbEffects(): EffectCatalog {
    return {
      effects: EFFECT_NAMES.map((name, id) => ({
        id,
        name,
        controls: {
          color: true,
          colorful: true,
          brightness: true,
          speed: name !== 'Static',
          direction: ['left', 'right'],
        },
      })),
      brightness: { min: 0, max: 4 },
      speed: { min: 0, max: 4 },
    };
  }
  private guard(): void {
    if (!this.opts.allowExperimental)
      throw new SafetyBlockedError(
        'The CRS protocol is community-documented and unverified; enable experimental mode.',
      );
  }
  override async setRgbConfig(c: RgbConfig): Promise<void> {
    this.guard();
    const color = nearestCrsColor(c.color, c.colorful);
    await this.t!.sendOutputReport(
      0,
      crsPacket(CrsOp.MODE, [
        c.effect,
        clamp(c.brightness, 0, 4),
        clamp(c.speed, 0, 4),
        c.direction === 'right' ? 1 : 0,
        color,
        0,
      ]),
    );
  }
  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    this.guard();
    const buf = new Uint8Array(108 * 3);
    for (const [k, v] of Object.entries(colors)) {
      const n = Number(k);
      if (n >= 0 && n < 108)
        buf.set([Math.min(254, v.r), Math.min(254, v.g), Math.min(254, v.b)], n * 3);
    }
    await this.t!.sendOutputReport(0, crsPacket(CrsOp.MODE, [0x17, 0x04, 0x03, 0x00, 0x07, 0x00]));
    await this.t!.sendOutputReport(0, crsPacket(CrsOp.BEGIN_EDIT));
    await this.t!.sendOutputReport(0, crsPacket(CrsOp.APPLY));
    for (let i = 0; i < 6; i++)
      await this.t!.sendOutputReport(
        0,
        crsPacket(CrsOp.FRAME0 + i, Array.from(buf.subarray(i * 54, i * 54 + 54))),
      );
  }
}

export const crsProtocol: ProtocolDefinition = {
  id: 'crs-aa55cc33',
  manifest: {
    version: '0.1.0',
    status: 'research',
    transports: { input: ['usb', '2.4ghz'], configuration: ['usb', '2.4ghz'] },
    verification: 'Identification only; not tested on hardware by OpenKey.',
    safety: 'Lighting writes from community documentation need the experimental opt-in.',
    provenance: [
      { source: 'public-reverse-engineering', reference: 'armoredvortex/ajazz-ak820-max-plus', status: Evidence.INFERRED },
    ],
  },
  name: 'CRS AK820 Max Plus protocol (AA 55 CC 33, community-documented)',
  family: 'crs-aa55cc33',
  priority: 30,
  supportedDevices: 'AK820 Max Plus with CRS controller (1A2C:A036 / 1A2C:8FFF)',
  supportedFirmware: 'unknown',
  requiredUsagePages: [CRS_USAGE_PAGE],
  requiredReports: ['FF02 output 64B'],
  evidence: ['armoredvortex/ajazz-ak820-max-plus PROTOCOL.md', 'arafatamim/OpenRGBAK820Plugin'],
  match(group): CandidateMatch {
    const ok =
      group.identity.vendorId === CRS_VENDOR_ID &&
      !!findInterface(group, (c) => c.usagePage === CRS_USAGE_PAGE);
    return ok
      ? {
          applicable: true,
          score: 60,
          reasons: ['VID 1A2C', 'FF02 vendor collection'],
          rejections: [],
        }
      : {
          applicable: false,
          score: 0,
          reasons: [],
          rejections: ['not a CRS (VID 1A2C, FF02) device'],
        };
  },
  async probe(_ctx: ProbeContext): Promise<ProbeResult> {
    return {
      status: 'skipped',
      confidence: Evidence.INFERRED,
      summary: 'No verified read-only command; descriptor signature only.',
      steps: [],
      facts: {},
    };
  },
  async createDriver(group, opts) {
    return new CrsDriver(group, opts);
  },
};

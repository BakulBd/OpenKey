import { FeatureStatus, SafetyLevel } from '@openkey/core';
import {
  BaseKeyboardDriver,
  Evidence,
  SafetyBlockedError,
  UnsupportedFeatureError,
  configurable,
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
  SettingsSchema,
  SystemSettings,
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
import { ADAPTER_API_VERSION } from '../../registry.js';
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
  // Effect 0 (off) carries no colour or levels (VitalyArt rgbLEDReport).
  if (c.effect !== 0) {
    b[4] = clamp(c.color.r, 0, 255);
    b[5] = clamp(c.color.g, 0, 255);
    b[6] = clamp(c.color.b, 0, 255);
    b[11] = c.colorful ? 1 : 0;
    b[12] = c.brightness;
    b[13] = c.speed;
    b[14] = DIRECTION_CODES[c.direction];
  }
  b[17] = 0xaa;
  b[18] = 0x55;
  return donglePacket(b);
}

/**
 * Sent 50 ms before each lighting packet by VitalyArt/Aula-F75-Max-Driver (MIT, `rgbCommitReport`)
 * on the AULA 05AC:024F receiver: `0F`, zeros, checksum.
 */
export const DONGLE_LIGHTING_PREAMBLE = [0x0f];
export const DONGLE_LIGHTING_PREAMBLE_MS = 50;

/**
 * Receiver settings packet (VitalyArt `keyResponseReport` / `gameModeReport`, MIT):
 *   07 10 00 00 01 01 01 01 [8]=fn switch [9]=sleep 00 [11]=key response
 *   [12]=game mode [13]=disable Alt+Tab [14]=disable Alt+F4 [15]=disable Win 00 AA 55 … checksum
 * The source always sends fn switch 1, and sets the three locks together with game mode.
 */
export const DONGLE_SETTINGS_OFFSETS = {
  fnSwitch: 8,
  sleepTime: 9,
  keyResponseTime: 11,
  gameMode: 12,
  disableAltTab: 13,
  disableAltF4: 14,
  disableWinKey: 15,
} as const;
const DONGLE_FN_SWITCH = 1;

export function dongleSettingsPacket(s: SystemSettings): Uint8Array {
  const b = new Array(DONGLE_REPORT_BYTES - 1).fill(0);
  b.splice(0, 8, 0x07, 0x10, 0x00, 0x00, 0x01, 0x01, 0x01, 0x01);
  const game = s.gameMode ? 1 : 0;
  const o = DONGLE_SETTINGS_OFFSETS;
  b[o.fnSwitch] = DONGLE_FN_SWITCH;
  b[o.sleepTime] = clamp(s.sleepTime ?? 0, 0, 3);
  b[o.keyResponseTime] = clamp(s.keyResponseTime ?? 1, 1, 5);
  b[o.gameMode] = game;
  b[o.disableAltTab] = game;
  b[o.disableAltF4] = game;
  b[o.disableWinKey] = game;
  b[17] = 0xaa;
  b[18] = 0x55;
  return donglePacket(b);
}

/** Sleep and key-response choices of the official AULA NOVA75 driver (language ids 141–145, 600–621). */
export const DONGLE_SETTINGS_SCHEMA: SettingsSchema = {
  sleepTime: [
    { value: 0, label: 'Never' },
    { value: 1, label: '1 minute' },
    { value: 2, label: '5 minutes' },
    { value: 3, label: '30 minutes' },
  ],
  keyResponseTime: [
    { value: 1, label: 'Level 1 (≈5–6 ms on 2.4 GHz)' },
    { value: 2, label: 'Level 2 (≈7–9 ms on 2.4 GHz)' },
    { value: 3, label: 'Level 3 (≈10–12 ms on 2.4 GHz)' },
    { value: 4, label: 'Level 4 (≈15–17 ms on 2.4 GHz)' },
    { value: 5, label: 'Level 5 (≈19–21 ms on 2.4 GHz)' },
  ],
};

const DEFAULT_DONGLE_SETTINGS: SystemSettings = {
  sleepTime: 0,
  keyResponseTime: 1,
  gameMode: false,
};
const SETTINGS_MIRROR = 'sonix-dongle/settings';

/** The keyboard behind a receiver, told apart by the receiver's product string. */
export interface ReceiverModel {
  model: string;
  profileId: string;
  layout: string;
  brightnessMax: number;
  speedMax: number;
  /** AULA receivers: lighting preamble and settings packet as VitalyArt sends them. */
  aula: boolean;
}

const AK820_RECEIVER: ReceiverModel = {
  model: 'AJAZZ AK820 2.4 GHz receiver',
  profileId: 'ak820-dongle',
  layout: 'ak820-max',
  brightnessMax: 5,
  speedMax: 5,
  aula: false,
};

/** Official AULA NOVA75 driver rgb-keyboard.xml: brightness_max 6, speed_max 6, 80 keys. */
const NOVA75_RECEIVER: ReceiverModel = {
  model: 'AULA NOVA75 2.4 GHz receiver',
  profileId: 'aula-nova75-dongle',
  layout: 'aula-nova75',
  brightnessMax: 6,
  speedMax: 6,
  aula: true,
};

export function receiverModel(productName: string): ReceiverModel {
  return /NOVA75/i.test(productName) ? NOVA75_RECEIVER : AK820_RECEIVER;
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
  private readonly rx: ReceiverModel;
  constructor(
    private readonly group: HidDeviceGroup,
    private readonly opts: DriverOptions,
  ) {
    super();
    this.rx = receiverModel(group.identity.productName);
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
    return getLayout(this.rx.layout);
  }
  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    c.deviceInfo = {
      status: FeatureStatus.READ_ONLY,
      read: 'device',
      write: false,
      confidence: Evidence.VERIFIED,
    };
    c.battery = {
      status: FeatureStatus.READ_ONLY,
      read: 'device',
      write: false,
      confidence: Evidence.OBSERVED,
      source: 'FUN_00435890: ping 20 01, answer byte 3',
    };
    c.tft = {
      status: FeatureStatus.NOT_SUPPORTED,
      read: 'none',
      write: false,
      confidence: Evidence.OBSERVED,
      note: 'Official menu_wireless: screen=0',
    };
    c.rgb = {
      status: FeatureStatus.WRITE_ONLY,
      read: 'none',
      write: true,
      safety: SafetyLevel.CAUTION,
      confidence: Evidence.INFERRED,
      note: 'Experimental: official 2.4 GHz lighting packet, not hardware-verified.',
    };
    c.perKeyRgb = {
      status: FeatureStatus.NOT_SUPPORTED,
      read: 'none',
      write: false,
      confidence: Evidence.OBSERVED,
      note: 'The 2.4 GHz per-key packet is not documented; use the USB cable for per-key colours.',
    };
    c.macros = {
      status: FeatureStatus.NOT_SUPPORTED,
      read: 'none',
      write: false,
      confidence: Evidence.OBSERVED,
      note: 'The 2.4 GHz macro packets are not documented; use the USB cable for macros and keys.',
    };
    if (this.rx.aula) {
      const src = {
        source: 'VitalyArt/Aula-F75-Max-Driver (MIT): keyResponseReport, gameModeReport',
      };
      const why =
        'Experimental: the receiver cannot report it back; OpenKey shows what it last sent.';
      c.sleep = configurable('mirror', true, Evidence.INFERRED, {
        safety: SafetyLevel.CAUTION,
        note: why,
        ...src,
      });
      c.keyResponse = configurable('mirror', true, Evidence.INFERRED, {
        safety: SafetyLevel.CAUTION,
        note: why,
        ...src,
      });
      c.gameMode = configurable('mirror', true, Evidence.INFERRED, {
        safety: SafetyLevel.CAUTION,
        note: 'Game mode also locks the Win key, Alt+Tab and Alt+F4, as the source sends it.',
        ...src,
      });
    }
    return c;
  }
  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      model: this.rx.model,
      profileId: this.rx.profileId,
      identity: this.group.identity,
      firmware: { version: null, source: 'not exposed', confidence: Evidence.HYPOTHESIS },
      transport: '2.4ghz',
      protocol: { id: this.protocolId, name: 'AJAZZ 2.4 GHz receiver protocol (32-byte reports)' },
      battery: null,
      fields: [],
    };
  }
  override getRgbEffects(): EffectCatalog {
    return effectCatalog(this.rx.brightnessMax, this.rx.speedMax);
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
    if (this.rx.aula) {
      await this.t!.sendOutputReport(0, donglePacket(DONGLE_LIGHTING_PREAMBLE));
      await this.pause(DONGLE_LIGHTING_PREAMBLE_MS);
    }
    await this.t!.sendOutputReport(0, dongleLightingPacket(config));
  }

  override getSettingsSchema(): SettingsSchema {
    return this.rx.aula ? DONGLE_SETTINGS_SCHEMA : {};
  }

  override async getSystemSettings(): Promise<SystemSettings> {
    if (!this.rx.aula) return super.getSystemSettings();
    const mirror = await this.opts.store.get<SystemSettings>(SETTINGS_MIRROR);
    return { ...DEFAULT_DONGLE_SETTINGS, ...mirror };
  }

  override async setSystemSettings(settings: SystemSettings): Promise<void> {
    if (!this.rx.aula) return super.setSystemSettings(settings);
    if (!this.opts.allowExperimental)
      throw new SafetyBlockedError(
        '2.4 GHz settings are experimental; enable experimental mode to use them.',
      );
    const merged = { ...(await this.getSystemSettings()), ...settings };
    await this.t!.sendOutputReport(0, dongleSettingsPacket(merged));
    await this.opts.store.set(SETTINGS_MIRROR, {
      sleepTime: merged.sleepTime,
      keyResponseTime: merged.keyResponseTime,
      gameMode: merged.gameMode,
    });
  }

  override async getGameMode(): Promise<boolean> {
    if (!this.rx.aula) return super.getGameMode();
    return !!(await this.getSystemSettings()).gameMode;
  }

  override async setGameMode(enabled: boolean): Promise<void> {
    if (!this.rx.aula) return super.setGameMode(enabled);
    await this.setSystemSettings({ gameMode: enabled });
  }

  private pause(ms: number): Promise<void> {
    if (this.opts.cmdDelayMs === 0) return Promise.resolve();
    return (this.opts.sleep ?? ((d) => new Promise((r) => setTimeout(r, d))))(ms);
  }
}

/** Receiver identities listed in the official AK820 and AULA NOVA75 drivers' config.xml. */
const OFFICIAL_RECEIVERS: readonly [number, number][] = [
  [0x0c45, 0xfdfd],
  [0x05ac, 0x024f],
];

export const sonixDongleProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: 'sonix-dongle',
  manifest: {
    version: '0.1.0',
    status: 'research',
    transports: { input: ['2.4ghz'], configuration: ['2.4ghz'] },
    verification: 'Implemented from the official driver; no receiver was available for testing.',
    safety:
      'The ping and battery read run on their own; lighting and settings writes need the experimental opt-in.',
    provenance: [
      {
        source: 'official-driver',
        reference: 'AK820 MAX driver FUN_0044f5f0 / FUN_0042b2a0',
        status: Evidence.OBSERVED,
      },
      {
        source: 'public-reverse-engineering',
        reference:
          'VitalyArt/Aula-F75-Max-Driver (MIT): same ping and checksum on 05AC:024F; lighting preamble, sleep, key response and game mode packets',
        status: Evidence.INFERRED,
      },
      {
        source: 'official-driver',
        reference:
          'AULA NOVA75 driver Beta 1.0.0.2 config.xml (05AC:024F "2.4G Dongle", MI_03) and rgb-keyboard.xml (menu_wireless, brightness/speed max 6)',
        status: Evidence.OBSERVED,
      },
    ],
    license: 'MIT',
    limitations: [
      'No receiver was available to OpenKey; nothing is hardware-verified.',
      'The ping fails while the keyboard is asleep or unlinked.',
      'Per-key colours, macros, keys and the screen are not offered over the receiver; use the USB cable.',
      'Settings cannot be read back; OpenKey shows what it last sent.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'AJAZZ 2.4 GHz receiver protocol (32-byte output reports + checksum)',
  family: 'sonix-dongle',
  priority: 45,
  supportedDevices: 'AK820 Pro / MAX and AULA NOVA75 receivers 0C45:FDFD and 05AC:024F',
  supportedFirmware: 'unknown',
  requiredUsagePages: [],
  requiredReports: ['vendor collection with 32-byte output report'],
  evidence: [
    'Official AK820 MAX driver FUN_0044f5f0 / FUN_0042b2a0',
    'Official AULA NOVA75 driver config.xml / rgb-keyboard.xml',
    'afonsusousa/mrworldwide',
    'VitalyArt/Aula-F75-Max-Driver (MIT)',
  ],
  match(group): CandidateMatch {
    if (!isReceiver(group))
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['not a known AJAZZ/AULA receiver identity'],
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
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'output',
        collection: '32-byte vendor command collection',
        reportId: 0,
        payloadPrefix: '20 01',
        purpose:
          'Ping (official driver FUN_00435890); the answer carries link state and battery. Byte 31 is a checksum.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
      {
        level: 'handshake',
        op: 'input-read',
        collection: '32-byte vendor command collection',
        reportId: 0,
        payloadPrefix: '',
        purpose: 'Pong echoes 20 01.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
    ],
    autoConsent(group) {
      const { vendorId, productId, productName } = group.identity;
      const official = OFFICIAL_RECEIVERS.some(([v, p]) => v === vendorId && p === productId);
      // 05AC:024F is a generic receiver identity other brands use too: only a product string an
      // official driver lists for it (AJAZZ AK820 names; "2.4G Dongle" in the AULA NOVA75
      // config.xml) makes it the receiver those drivers ping. "AULA-NOVA75-2" is what a user's
      // receiver reports but not what the config names, so it asks once.
      if (
        official &&
        vendorId === 0x05ac &&
        !/AJAZZ|AK820/i.test(productName) &&
        productName.trim() !== '2.4G Dongle'
      )
        return {
          auto: false,
          reason: `05AC:024F is a receiver identity several brands use, and "${productName}" is not a name an official driver lists for it`,
        };
      return official
        ? { auto: true, reason: 'an official driver pings this receiver identity' }
        : {
            auto: false,
            reason: 'matched by product name only; not an identity from the official driver',
          };
    },
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    if (ctx.level !== 'handshake')
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
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
      confidence: ok ? Evidence.OBSERVED : Evidence.HYPOTHESIS,
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
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    return new SonixDongleDriver(group, opts);
  },
};

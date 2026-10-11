import {
  BaseKeyboardDriver,
  Evidence,
  FeatureStatus,
  ProtocolError,
  ReadbackMismatchError,
  SafetyLevel,
  configurable,
  emptyCapabilities,
  feature,
  sleep as realSleep,
} from '@openkey/core';
import type { Capabilities, DeviceInfo, EffectCatalog, KeyboardLayout, RgbConfig, TransportMode } from '@openkey/core';
import { getLayout } from '@openkey/devices';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import { Cmd, DELAY_MS, FLAG_FIXED, FLAG_RAINBOW, MAX_MODE, MODES, REPORT_BYTES, ROYUAN_PROTOCOL_ID } from './constants.js';
import { isAnswer, packet } from './packet.js';

export type RoyuanFamily = 'yc500' | 'gen2';

/** One command channel; every exchange is SET then GET, paced. */
export class RoyuanSession {
  constructor(
    readonly transport: HidTransport,
    private readonly delayMs = DELAY_MS,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {}

  /** Sends a GET-style command and returns the reply, or null when the firmware did not answer it. */
  async query(bytes: readonly number[]): Promise<Uint8Array | null> {
    const req = packet(bytes);
    await this.transport.sendFeatureReport(0, req);
    await this.sleep(this.delayMs);
    const reply = await this.transport.receiveFeatureReport(0, REPORT_BYTES);
    return isAnswer(reply, req) ? reply : null;
  }

  async write(bytes: readonly number[], checksum: 'bit7' | 'bit8'): Promise<void> {
    await this.transport.sendFeatureReport(0, packet(bytes, checksum));
    await this.sleep(this.delayMs);
  }
}

/** Identify reply → device id (the vendor's model record number). */
export const deviceIdOf = (r: Uint8Array): number => (r[1]! | (r[2]! << 8) | (r[3]! << 16) | (r[4]! << 24)) >>> 0;

/**
 * Speed is a frame divider, inverted: yc500 takes 1..5 (host 0 → 5), gen2 takes 0..4 (host 4 → 0).
 */
export const speedToWire = (host: number, f: RoyuanFamily): number => (f === 'yc500' ? 5 - host : 4 - host);
export const speedFromWire = (wire: number, f: RoyuanFamily): number => Math.max(0, Math.min(4, f === 'yc500' ? 5 - wire : 4 - wire));

/**
 * ROYUAN driver: identification and the lighting register, the one write whose opcode and payload are
 * the same in both command sets. Keymap, macros, settings and the screen use opcodes that mean
 * different things per family and are not written.
 */
export class RoyuanDriver extends BaseKeyboardDriver {
  readonly protocolId = ROYUAN_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: RoyuanSession | null = null;
  family: RoyuanFamily = 'gen2';
  firmware: string | null = null;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    readonly deviceId: number,
    private readonly opts: { open: (i: HidInterfaceInfo) => Promise<HidTransport>; delayMs?: number; sleep?: (ms: number) => Promise<void> },
  ) {
    super();
    this.transport = group.transportHint;
  }

  private s(): RoyuanSession {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  async connect(): Promise<void> {
    this.session = new RoyuanSession(await this.opts.open(this.iface), this.opts.delayMs ?? DELAY_MS, this.opts.sleep);
    const rev = await this.session.query([Cmd.REVISION]);
    const word = rev ? (rev[2]! << 8) | rev[1]! : 0;
    if (word) {
      this.family = 'yc500';
      this.firmware = word.toString(16);
    } else {
      this.family = 'gen2';
      const id = await this.session.query([Cmd.IDENTIFY]);
      const v = id ? (id[8]! << 8) | id[7]! : 0;
      this.firmware = v ? v.toString(16) : null;
    }
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
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, { read: 'device', confidence: Evidence.VERIFIED, source: 'identify 0x8F' });
    c.rgb =
      this.transport === 'usb'
        ? configurable('device', true, Evidence.INFERRED, {
            safety: SafetyLevel.SAFE_PERSISTENT,
            source: 'LEDPARAM 0x87/0x07 (sharkfin, hardware-tested on other boards)',
            note: 'Some boards swap “fixed colour” and “rainbow”; the brightness range is 0–4 on most boards.',
          })
        : feature(FeatureStatus.TRANSPORT_LIMITED, { confidence: Evidence.INFERRED, note: 'Through the receiver every packet must be relayed; connect the cable.' });
    for (const f of ['keymap', 'macros', 'sleep', 'debounce', 'tft'] as const)
      c[f] = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, { confidence: Evidence.INFERRED, note: 'The two ROYUAN command sets use these opcodes for different registers; OpenKey writes them only after the family is verified on hardware.' });
    c.factoryDefaults = feature(FeatureStatus.NOT_SUPPORTED, { confidence: Evidence.OBSERVED, note: 'Factory reset exists; OpenKey never sends it.' });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const id = this.group.identity;
    return {
      model: id.productName || 'ROYUAN keyboard',
      profileId: `royuan-${this.deviceId}`,
      identity: id,
      firmware: { version: this.firmware, source: this.family === 'yc500' ? 'GET 0x80' : 'identify bytes 7..8', confidence: this.firmware ? Evidence.OBSERVED : Evidence.UNKNOWN },
      transport: this.transport,
      protocol: { id: this.protocolId, name: `ROYUAN (${this.family})` },
      battery: null,
      fields: [
        { key: 'deviceId', label: 'Device record', value: this.deviceId, confidence: Evidence.VERIFIED, source: 'identify 0x8F' },
        { key: 'family', label: 'Command set', value: this.family, confidence: Evidence.OBSERVED, source: 'GET 0x80 (zeros on gen2)' },
      ],
    };
  }

  override getRgbEffects(): EffectCatalog {
    return {
      effects: MODES.map(([id, name]) => ({ id, name, controls: { color: true, colorful: true, brightness: true, speed: id !== 1, direction: [] } })),
      brightness: { min: 0, max: 4 },
      speed: { min: 0, max: 4 },
    };
  }

  private async readLed(): Promise<Uint8Array> {
    const r = await this.s().query([Cmd.GET_LEDPARAM]);
    if (!r) throw new ProtocolError('The keyboard did not answer the lighting read.');
    return r;
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    const r = await this.readLed();
    const flags = r[4]! & 0x0f;
    return {
      effect: r[1]!,
      speed: speedFromWire(r[2]!, this.family),
      brightness: r[3]!,
      colorful: flags === FLAG_RAINBOW,
      color: { r: r[5]!, g: r[6]!, b: r[7]! },
      direction: 'right',
    };
  }

  override async setRgbConfig(config: RgbConfig): Promise<void> {
    if (!MODES.some(([id]) => id === config.effect) || config.effect > MAX_MODE) throw new ProtocolError(`Lighting mode ${config.effect} is not offered for this family.`);
    const before = await this.readLed();
    const option = before[4]! >> 4;
    const clampB = Math.max(0, Math.min(4, Math.round(config.brightness)));
    const speed = speedToWire(Math.max(0, Math.min(4, Math.round(config.speed))), this.family);
    // Pure white is sent as FA FA FA, as the vendor software does.
    const c = (v: number) => Math.min(0xfa, Math.max(0, Math.round(v)));
    const body = [Cmd.SET_LEDPARAM, config.effect, speed, clampB, (option << 4) | (config.colorful ? FLAG_RAINBOW : FLAG_FIXED), c(config.color.r), c(config.color.g), c(config.color.b)];
    await this.s().write(body, 'bit8');
    const after = await this.readLed();
    const bad = [1, 2, 3, 4, 5, 6, 7].filter((i) => after[i] !== body[i]);
    if (bad.length) throw new ReadbackMismatchError('The keyboard did not keep the lighting setting.', { bytes: bad });
  }
}

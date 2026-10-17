import {
  BaseKeyboardDriver,
  Evidence,
  FeatureStatus,
  ProtocolError,
  ReadbackMismatchError,
  SafetyLevel,
  TimeoutError,
  configurable,
  emptyCapabilities,
  feature,
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
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import {
  BRIGHTNESS_MAX,
  CUSTOM_MODE,
  Cmd,
  EFFECT_BYTES,
  HUB_PROTOCOL_ID,
  TABLE_BYTES,
  decodeEffect,
  decodeInfo,
  decodeTable,
  encodeEffect,
  encodeTable,
  isEffectBlock,
  parseReply,
  requests,
} from './codec.js';
import type { HubEffect, HubInfo } from './codec.js';
import { hubLayout } from './models.js';
import type { HubModel } from './models.js';

/** One transfer at a time; each packet waits for its own reply before the next is sent. */
export class HubSession {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly transport: HidTransport,
    readonly reportSize: number,
    private readonly replyMs: number,
  ) {}

  transfer(cmd: number, data: Uint8Array): Promise<Uint8Array> {
    const run = async () => {
      const out = new Uint8Array(data.length);
      for (const req of requests(cmd, data, this.reportSize)) {
        this.transport.drainInput();
        await this.transport.sendOutputReport(0, req);
        const addr = req[3]! | (req[4]! << 8);
        const deadline = Date.now() + this.replyMs;
        for (;;) {
          const r = await this.transport.readInputReport(Math.max(1, deadline - Date.now()));
          if (!r)
            throw new TimeoutError(
              'The keyboard did not answer (asleep or out of range? press a key to wake it).',
            );
          const reply = parseReply(r);
          if (reply && reply.cmd === cmd && reply.addr === addr) {
            out.set(reply.data.subarray(0, Math.min(reply.data.length, data.length - addr)), addr);
            break;
          }
          if (Date.now() >= deadline) throw new TimeoutError('The keyboard did not answer.');
        }
      }
      return out;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  read(cmd: number, bytes: number): Promise<Uint8Array> {
    return this.transfer(cmd, new Uint8Array(bytes));
  }
}

const builtIn = (n: number) => `Built-in effect ${n}`;

/**
 * AULA F87S 8K and AJAZZ AK680 V2 / MAX: device info and battery; lighting effect, colour,
 * brightness and speed where the keyboard answers the lighting read; per-key colours on models whose
 * LED map is confirmed. Everything is read from the keyboard, changed in place and read back.
 */
export class HubDriver extends BaseKeyboardDriver {
  readonly protocolId = HUB_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: HubSession | null = null;
  info: HubInfo | null = null;
  /** Whether the keyboard answered the lighting read with a valid block. */
  lighting = false;
  private readonly layout: KeyboardLayout | null;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    readonly model: HubModel,
    private readonly reportSize: number,
    private readonly open: (i: HidInterfaceInfo) => Promise<HidTransport>,
  ) {
    super();
    this.transport = group.transportHint;
    this.layout = hubLayout(model);
  }

  private s(): HubSession {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  /** True when the keyboard the receiver relays is the model this entry describes. */
  get bodyMatches(): boolean {
    return (
      !!this.info &&
      this.info.vendorId === this.model.body.vendorId &&
      this.info.productId === this.model.body.productId
    );
  }

  private get perKey(): boolean {
    return !!this.model.ledMap && this.bodyMatches && this.lighting;
  }

  async connect(): Promise<void> {
    this.session = new HubSession(
      await this.open(this.iface),
      this.reportSize,
      this.model.link === 'usb' ? 1000 : 2500,
    );
    this.info = decodeInfo(await this.session.read(Cmd.DEVICE_INFO, this.model.infoBytes));
    // Only a valid answer to the lighting read enables lighting; a model without it times out here.
    const block = await this.session.read(Cmd.GET_LED_EFFECT, EFFECT_BYTES).catch(() => null);
    this.lighting = !!block && isEffectBlock(block) && this.bodyMatches;
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.transport.close().catch(() => undefined);
  }

  getLayout(): KeyboardLayout {
    return (
      this.layout ?? {
        id: 'hub',
        name: this.model.name,
        width: 1,
        height: 1,
        keys: [],
        source: 'no layout is confirmed for this model',
      }
    );
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const ev = this.model.ledMap ? Evidence.OBSERVED : Evidence.INFERRED;
    const src = this.model.source;
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.OBSERVED,
      source: 'device info (0x10)',
    });
    if (this.info?.battery !== null && this.info?.battery !== undefined)
      c.battery = feature(FeatureStatus.READ_ONLY, {
        read: 'device',
        confidence: Evidence.OBSERVED,
        source: 'device info (0x10)',
      });
    const other =
      this.info && !this.bodyMatches
        ? `The receiver is paired with another keyboard (${this.info.vendorId.toString(16).padStart(4, '0')}:${this.info.productId.toString(16).padStart(4, '0')}); OpenKey changes nothing through it.`
        : null;
    c.rgb = this.lighting
      ? configurable('device', true, ev, {
          safety: SafetyLevel.SAFE_PERSISTENT,
          source: src,
          value: 'effect, colour, brightness 0–5 and speed',
          note: 'Read from the keyboard; only the changed fields are written, then read back.',
        })
      : feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
          confidence: Evidence.INFERRED,
          note: other ?? 'The keyboard did not answer the lighting read; lighting is left alone.',
        });
    c.perKeyRgb = this.perKey
      ? configurable('device', true, ev, {
          safety: SafetyLevel.SAFE_PERSISTENT,
          source: src,
          value: `${Object.keys(this.model.ledMap!).length} keys`,
          note: 'The whole 128-slot table is read, changed and written back, then read again.',
        })
      : feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
          confidence: Evidence.INFERRED,
          note: other ?? 'The LED map of this model is not confirmed yet.',
        });
    c.keymap = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
      confidence: Evidence.INFERRED,
      note: 'The key-map commands are documented for some models but not with read-back; not written yet.',
    });
    if (this.model.name.includes('AK680'))
      c.actuation = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
        confidence: Evidence.INFERRED,
        note: 'Magnetic switches: actuation and Rapid Trigger are read by community tools but not written with read-back yet; use the AJAZZ web driver.',
      });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const i = this.info;
    return {
      model: this.model.name,
      profileId: `hub-${this.model.productId.toString(16)}`,
      identity: this.group.identity,
      firmware: {
        version: i?.firmware ?? null,
        source: 'device info (0x10)',
        confidence: Evidence.OBSERVED,
      },
      transport: this.transport,
      protocol: { id: this.protocolId, name: 'AULA/AJAZZ web-driver protocol (AA/55)' },
      battery: i && i.battery !== null ? { level: i.battery, charging: i.charging === 1 } : null,
      fields: i
        ? [
            {
              key: 'body',
              label: 'Keyboard',
              value: `${i.vendorId.toString(16).padStart(4, '0')}:${i.productId.toString(16).padStart(4, '0')}${this.bodyMatches ? '' : ' (not this model)'}`,
              confidence: Evidence.VERIFIED,
              source: 'device info (0x10)',
            },
          ]
        : [],
    };
  }

  override async getBattery(): Promise<{ level: number; charging: boolean } | null> {
    const i = decodeInfo(await this.s().read(Cmd.DEVICE_INFO, this.model.infoBytes));
    this.info = i;
    return i.battery !== null ? { level: i.battery, charging: i.charging === 1 } : null;
  }

  private requireLighting(): void {
    if (!this.lighting)
      throw new ProtocolError('Lighting is not available on this keyboard or link.');
  }

  private async effect(): Promise<HubEffect> {
    return decodeEffect(await this.s().read(Cmd.GET_LED_EFFECT, EFFECT_BYTES));
  }

  override getRgbEffects(): EffectCatalog {
    const effects = Array.from({ length: 19 }, (_, i) => ({
      id: i + 1,
      name: builtIn(i + 1),
      controls: { color: true, colorful: false, brightness: true, speed: true, direction: [] },
    }));
    if (this.perKey)
      effects.push({
        id: CUSTOM_MODE,
        name: 'Custom (per-key colours)',
        controls: { color: false, colorful: false, brightness: true, speed: false, direction: [] },
      });
    return {
      effects,
      brightness: { min: 0, max: BRIGHTNESS_MAX },
      speed: { min: 0, max: 5 },
      ...(this.perKey ? { customEffect: CUSTOM_MODE } : {}),
    };
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    this.requireLighting();
    const e = await this.effect();
    return {
      effect: e.mode,
      color: e.color,
      colorful: false,
      brightness: e.brightness,
      speed: e.speed,
      direction: 'right',
    };
  }

  private async writeEffect(e: Omit<HubEffect, 'raw'>): Promise<void> {
    const base = await this.effect();
    const block = encodeEffect(base.raw, e);
    await this.s().transfer(Cmd.SET_LED_EFFECT, block);
    const back = (await this.effect()).raw;
    for (const i of [0, 1, 2, 3, 9, 10])
      if (back[i] !== block[i])
        throw new ReadbackMismatchError(
          `The keyboard did not keep the lighting change (byte ${i}).`,
        );
  }

  override async setRgbConfig(c: RgbConfig): Promise<void> {
    this.requireLighting();
    if (c.effect === CUSTOM_MODE && !this.perKey)
      throw new ProtocolError('Custom per-key lighting is not available here.');
    await this.writeEffect({
      mode: c.effect,
      color: c.color,
      brightness: c.brightness,
      speed: c.speed,
    });
  }

  private requirePerKey(): Record<string, number> {
    if (!this.perKey)
      throw new ProtocolError('Per-key colours are not available on this keyboard or link.');
    return this.model.ledMap!;
  }

  override async getPerKeyRgb(): Promise<PerKeyRgb> {
    const map = this.requirePerKey();
    const table = decodeTable(await this.s().read(Cmd.GET_CUSTOM_LED, TABLE_BYTES));
    return Object.fromEntries(Object.values(map).map((slot) => [slot, table[slot]!]));
  }

  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    const map = this.requirePerKey();
    const slots = new Set(Object.values(map));
    const table = decodeTable(await this.s().read(Cmd.GET_CUSTOM_LED, TABLE_BYTES));
    for (const [k, v] of Object.entries(colors)) {
      const slot = Number(k);
      if (!slots.has(slot)) throw new ProtocolError(`LED ${slot} is not a key of this keyboard.`);
      table[slot] = v;
    }
    const block = encodeTable(table);
    await this.s().transfer(Cmd.SET_CUSTOM_LED, block);
    const back = decodeTable(await this.s().read(Cmd.GET_CUSTOM_LED, TABLE_BYTES));
    for (const slot of slots)
      if (JSON.stringify(back[slot]) !== JSON.stringify(table[slot]))
        throw new ReadbackMismatchError(`The keyboard did not keep the colour of LED ${slot}.`);
    // Show the table: custom mode, keeping the brightness unless the lights are off.
    const e = await this.effect();
    await this.writeEffect({
      mode: CUSTOM_MODE,
      color: e.color,
      brightness: e.brightness > 0 ? e.brightness : BRIGHTNESS_MAX,
      speed: e.speed,
    });
  }
}

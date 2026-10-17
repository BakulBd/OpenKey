import {
  BaseKeyboardDriver,
  Evidence,
  FeatureStatus,
  ProtocolError,
  SafetyLevel,
  configurable,
  emptyCapabilities,
  feature,
  usageName,
} from '@openkey/core';
import type {
  Capabilities,
  DeviceInfo,
  EffectCatalog,
  KeyboardLayout,
  PerKeyRgb,
  PhysicalKey,
  Rgb,
  RgbConfig,
  StateStore,
  TransportMode,
} from '@openkey/core';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import {
  KIND_NAMES,
  LAMPARRAY_PROTOCOL_ID,
  decodeAttributes,
  decodeLamp,
  encodeControl,
  encodeMultiUpdate,
  encodeRangeUpdate,
  encodeRequest,
  purposeName,
  toLevel,
} from './codec.js';
import type { ArrayAttributes, Lamp, LampColor, ReportMap } from './codec.js';

/** Upper bound on lamps read at connect; the standard allows 65535, keyboards have a few hundred. */
export const MAX_LAMPS = 1024;
/** One key unit (19.05 mm) in micrometres. */
const KEY_UNIT_UM = 19050;

/**
 * Effects OpenKey offers on any LampArray: the device's own lighting, a solid colour, off, and the
 * per-key colours last set in the per-key studio.
 */
export const Effect = { DEVICE: 0, SOLID: 1, OFF: 2, PER_KEY: 3 } as const;
const EFFECTS = new Set<number>(Object.values(Effect));

/** Reads the attributes of every lamp: request lamp 0, then the device advances after each read. */
export async function readLamps(t: HidTransport, map: ReportMap, count: number): Promise<Lamp[]> {
  const lamps: Lamp[] = [];
  await t.sendFeatureReport(map.request, encodeRequest(0));
  for (let id = 0; id < count; id++) {
    let lamp = decodeLamp(await t.receiveFeatureReport(map.response, 28));
    // Devices that do not advance on their own are asked for each lamp.
    if (lamp.id !== id) {
      await t.sendFeatureReport(map.request, encodeRequest(id));
      lamp = decodeLamp(await t.receiveFeatureReport(map.response, 28));
      if (lamp.id !== id)
        throw new ProtocolError(`Asked for lamp ${id}, the device described lamp ${lamp.id}.`);
    }
    lamps.push(lamp);
  }
  return lamps;
}

/** A keyboard picture from the lamps' own positions: key lamps carry the key they sit under. */
export function layoutFromLamps(name: string, lamps: readonly Lamp[]): KeyboardLayout {
  // Positions are lamp centres; a key's position is its top-left corner.
  const pos = lamps.map((l) => ({ l, x: l.x / KEY_UNIT_UM - 0.5, y: l.y / KEY_UNIT_UM - 0.5 }));
  const minX = Math.min(...pos.map((p) => p.x));
  const minY = Math.min(...pos.map((p) => p.y));
  const keys: PhysicalKey[] = pos.map(({ l, x, y }) => ({
    id: `lamp${l.id}`,
    label: l.binding ? usageName(0x07, l.binding) : purposeName(l.purposes),
    slot: l.id,
    light: l.programmable ? l.id : null,
    usage: l.binding,
    x: Math.round((x - minX) * 100) / 100,
    y: Math.round((y - minY) * 100) / 100,
    w: 0.9,
    h: 0.9,
  }));
  const width = Math.max(1, ...keys.map((k) => k.x + 1));
  const height = Math.max(1, ...keys.map((k) => k.y + 1));
  return {
    id: 'lamparray',
    name: `${name} (${lamps.length} lamps)`,
    width: Math.ceil(width * 4) / 4,
    height: Math.ceil(height * 4) / 4,
    keys,
    source: 'Lamp positions and key bindings reported by the keyboard (HID LampArray attributes).',
  };
}

interface Mirror {
  rgb: RgbConfig;
  perKey: PerKeyRgb;
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * A keyboard that implements HID LampArray: per-lamp colours and a solid colour set by the host, or
 * the keyboard's own lighting. Colours set by the host are not stored by the keyboard (they last
 * until it is unplugged or takes its lighting back), and the standard has no colour read, so OpenKey
 * shows what it last sent.
 */
export class LampArrayDriver extends BaseKeyboardDriver {
  readonly protocolId = LAMPARRAY_PROTOCOL_ID;
  readonly transport: TransportMode;
  private t: HidTransport | null = null;
  attributes: ArrayAttributes | null = null;
  lamps: Lamp[] = [];
  private layout: KeyboardLayout | null = null;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    private readonly map: ReportMap,
    private readonly opts: {
      store: StateStore;
      open: (i: HidInterfaceInfo) => Promise<HidTransport>;
    },
  ) {
    super();
    this.transport = group.transportHint;
  }

  private get key(): string {
    const id = this.group.identity;
    return `hid-lamparray/${id.vendorId.toString(16)}:${id.productId.toString(16)}`;
  }

  private tr(): HidTransport {
    if (!this.t) throw new ProtocolError('Not connected');
    return this.t;
  }

  async connect(): Promise<void> {
    this.t = await this.opts.open(this.iface);
    this.attributes = decodeAttributes(await this.t.receiveFeatureReport(this.map.attributes, 22));
    const count = this.attributes.lampCount;
    if (count < 1 || count > MAX_LAMPS)
      throw new ProtocolError(
        `The keyboard reports ${count} lamps (OpenKey reads 1–${MAX_LAMPS}).`,
      );
    this.lamps = await readLamps(this.t, this.map, count);
    this.layout = layoutFromLamps(this.group.identity.productName || 'LampArray', this.lamps);
  }

  async disconnect(): Promise<void> {
    const t = this.t;
    this.t = null;
    await t?.close().catch(() => undefined);
  }

  getLayout(): KeyboardLayout {
    return (
      this.layout ?? {
        id: 'lamparray',
        name: 'LampArray',
        width: 1,
        height: 1,
        keys: [],
        source: 'not connected',
      }
    );
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const S = Evidence.OBSERVED;
    const src = 'HID Usage Tables, LampArray (page 0x59): a public standard';
    const volatile =
      'Colours set by OpenKey last until the keyboard is unplugged or takes its own lighting back; the standard has no colour read, so OpenKey shows what it last sent.';
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: S,
      source: 'LampArray attributes',
    });
    c.rgb = configurable('mirror', true, S, {
      safety: SafetyLevel.SAFE_VOLATILE,
      source: src,
      value: 'the keyboard’s own lighting, a solid colour, or off',
      note: volatile,
    });
    c.perKeyRgb = configurable('mirror', true, S, {
      safety: SafetyLevel.SAFE_VOLATILE,
      source: src,
      value: `${this.lamps.filter((l) => l.programmable).length || 'every'} programmable lamps`,
      note: volatile,
    });
    for (const f of ['keymap', 'macros', 'fnLayer'] as const)
      c[f] = feature(FeatureStatus.NOT_SUPPORTED, {
        confidence: S,
        note: 'HID LampArray covers lighting only. Key maps and macros use the keyboard’s own protocol.',
      });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const a = this.attributes;
    const mm = (um: number) => `${Math.round(um / 1000)} mm`;
    return {
      model: this.group.identity.productName || 'HID LampArray device',
      profileId: this.key.replace('/', '-'),
      identity: this.group.identity,
      firmware: { version: null, source: 'not part of LampArray', confidence: Evidence.UNKNOWN },
      transport: this.transport,
      protocol: { id: this.protocolId, name: 'HID LampArray (Dynamic Lighting)' },
      battery: null,
      fields: a
        ? [
            {
              key: 'lamps',
              label: 'Lamps',
              value: a.lampCount,
              confidence: Evidence.VERIFIED,
              source: 'LampArrayAttributesReport',
            },
            {
              key: 'kind',
              label: 'Device kind',
              value: KIND_NAMES[a.kind] ?? `kind ${a.kind}`,
              confidence: Evidence.VERIFIED,
              source: 'LampArrayAttributesReport',
            },
            {
              key: 'size',
              label: 'Lit area',
              value: `${mm(a.width)} × ${mm(a.height)}`,
              confidence: Evidence.VERIFIED,
              source: 'LampArrayAttributesReport bounding box',
            },
            {
              key: 'interval',
              label: 'Fastest update',
              value: `${(a.minUpdateIntervalUs / 1000).toFixed(1)} ms`,
              confidence: Evidence.VERIFIED,
              source: 'LampArrayAttributesReport',
            },
          ]
        : [],
    };
  }

  override getRgbEffects(): EffectCatalog {
    const none = { color: false, colorful: false, brightness: false, speed: false, direction: [] };
    return {
      effects: [
        { id: Effect.DEVICE, name: 'Keyboard’s own lighting', controls: none },
        {
          id: Effect.SOLID,
          name: 'Solid colour',
          controls: { ...none, color: true, brightness: true },
        },
        { id: Effect.OFF, name: 'Off', controls: none },
        { id: Effect.PER_KEY, name: 'Per-key colours', controls: none },
      ],
      brightness: { min: 0, max: 10 },
      speed: { min: 0, max: 0 },
      offEffect: Effect.OFF,
      customEffect: Effect.PER_KEY,
    };
  }

  private async mirror(): Promise<Mirror> {
    return (
      (await this.opts.store.get<Mirror>(this.key)) ?? {
        rgb: {
          effect: Effect.DEVICE,
          color: { r: 255, g: 255, b: 255 },
          colorful: false,
          brightness: 10,
          speed: 0,
          direction: 'right',
        },
        perKey: {},
      }
    );
  }

  private color(lamp: Lamp | undefined, rgb: Rgb): LampColor {
    const lv = lamp?.levels ?? { r: 255, g: 255, b: 255, i: 255 };
    return {
      r: toLevel(rgb.r, lv.r),
      g: toLevel(rgb.g, lv.g),
      b: toLevel(rgb.b, lv.b),
      i: toLevel(255, lv.i),
    };
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    return (await this.mirror()).rgb;
  }

  override async setRgbConfig(config: RgbConfig): Promise<void> {
    const t = this.tr();
    if (!EFFECTS.has(config.effect))
      throw new ProtocolError(`Effect ${config.effect} is not offered.`);
    const m = await this.mirror();
    if (config.effect === Effect.PER_KEY) {
      await this.sendFrame(m.perKey);
    } else if (config.effect === Effect.DEVICE) {
      await t.sendFeatureReport(this.map.control, encodeControl(true));
    } else {
      const scale =
        config.effect === Effect.OFF ? 0 : Math.max(0, Math.min(10, config.brightness)) / 10;
      const rgb = {
        r: config.color.r * scale,
        g: config.color.g * scale,
        b: config.color.b * scale,
      };
      await t.sendFeatureReport(this.map.control, encodeControl(false));
      const last = (this.attributes?.lampCount ?? 1) - 1;
      await t.sendFeatureReport(
        this.map.range,
        encodeRangeUpdate(0, last, this.color(this.lamps[0], rgb)),
      );
    }
    await this.opts.store.set(this.key, { ...m, rgb: config });
  }

  override async getPerKeyRgb(): Promise<PerKeyRgb> {
    return (await this.mirror()).perKey;
  }

  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    await this.sendFrame(colors);
    const m = await this.mirror();
    await this.opts.store.set(this.key, {
      perKey: colors,
      rgb: { ...m.rgb, effect: Effect.PER_KEY },
    });
  }

  /** Sends every programmable lamp (unset ones dark) as one frame. */
  private async sendFrame(colors: PerKeyRgb): Promise<void> {
    const t = this.tr();
    const lamps = this.lamps.filter((l) => l.programmable);
    if (!lamps.length) throw new ProtocolError('The keyboard has no programmable lamps.');
    await t.sendFeatureReport(this.map.control, encodeControl(false));
    const n = this.map.multiCapacity;
    for (let i = 0; i < lamps.length; i += n) {
      const batch = lamps.slice(i, i + n).map((l) => ({
        id: l.id,
        color: this.color(l, colors[l.id] ?? BLACK),
      }));
      await t.sendFeatureReport(this.map.multi, encodeMultiUpdate(n, batch, i + n >= lamps.length));
    }
  }
}

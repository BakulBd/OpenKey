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
import type {
  Capabilities,
  DeviceInfo,
  EffectCatalog,
  KeyboardLayout,
  PerKeyRgb,
  Rgb,
  RgbConfig,
  StateStore,
  TransportMode,
} from '@openkey/core';
import { ansiLayout } from '@openkey/devices';
import type { AnsiSize } from '@openkey/devices';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';

/**
 * Keyboards whose only documented lighting interface is "direct" control: the host takes the
 * lighting, sends a colour for every LED, and gives it back. Colours are not stored by the keyboard
 * and cannot be read back. An adapter supplies the LED order (key names of `ansiLayout`, '' for
 * unused slots) and three wire operations; this class provides capabilities, the effect list
 * (keyboard's own lighting, solid colour, per-key colours), the layout and the mirror.
 */
export interface DirectSpec {
  protocolId: string;
  protocolName: string;
  model: string;
  /** Key name of every LED slot, in wire order; '' where a slot has no key in the layout. */
  leds: readonly string[];
  size: AnsiSize;
  rightMods?: 'win' | 'fn';
  source: string;
  evidence: Evidence;
  /**
   * Whether a documented command gives the lighting back. Without one, "Keyboard’s own lighting" is
   * not offered (the keyboard returns to it when unplugged); OpenKey never invents a release.
   */
  canRelease: boolean;
}

export const DirectEffect = { KEYBOARD: 0, SOLID: 1, PER_KEY: 2 } as const;

interface Mirror {
  rgb: RgbConfig;
  perKey: PerKeyRgb;
}

export abstract class DirectLightingDriver extends BaseKeyboardDriver {
  readonly protocolId: string;
  readonly transport: TransportMode;
  protected t: HidTransport | null = null;
  private readonly layout: KeyboardLayout;
  private controlled = false;

  constructor(
    protected readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    protected readonly spec: DirectSpec,
    private readonly opts: {
      store: StateStore;
      open: (i: HidInterfaceInfo) => Promise<HidTransport>;
    },
  ) {
    super();
    this.protocolId = spec.protocolId;
    this.transport = group.transportHint;
    const index = new Map<string, number>();
    spec.leds.forEach((n, i) => n && !index.has(n) && index.set(n, i));
    this.layout = ansiLayout({
      id: spec.protocolId,
      name: `${spec.model} (ANSI ${spec.size === 'full' ? 'full size' : 'TKL'})`,
      size: spec.size,
      rightMods: spec.rightMods ?? 'fn',
      light: (n) => index.get(n) ?? null,
      source: spec.source,
    });
  }

  /** Takes the lighting from the keyboard's own effects (sent once before the first frame). */
  protected abstract takeControl(): Promise<void>;
  /** Sends a full frame: `frame[i]` is the colour of LED slot i. */
  protected abstract sendFrame(frame: Rgb[]): Promise<void>;
  /** Gives the lighting back to the keyboard (only called when `spec.canRelease`). */
  protected releaseControl(): Promise<void> {
    return Promise.reject(
      new ProtocolError('This keyboard has no command to take its lighting back; unplug it.'),
    );
  }

  protected tr(): HidTransport {
    if (!this.t) throw new ProtocolError('Not connected');
    return this.t;
  }

  private get key(): string {
    const id = this.group.identity;
    return `${this.spec.protocolId}/${id.vendorId.toString(16)}:${id.productId.toString(16)}`;
  }

  async connect(): Promise<void> {
    this.t = await this.opts.open(this.iface);
  }

  async disconnect(): Promise<void> {
    const t = this.t;
    this.t = null;
    this.controlled = false;
    await t?.close().catch(() => undefined);
  }

  getLayout(): KeyboardLayout {
    return this.layout;
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const note = this.spec.canRelease
      ? 'Not stored by the keyboard: it shows its own lighting again when unplugged or when you choose “Keyboard’s own lighting”. OpenKey shows what it last sent.'
      : 'Not stored by the keyboard: unplug it to see its own lighting again (no command gives it back). OpenKey shows what it last sent.';
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.OBSERVED,
      source: 'USB identity',
    });
    c.rgb = configurable('mirror', true, this.spec.evidence, {
      safety: SafetyLevel.SAFE_VOLATILE,
      source: this.spec.source,
      note,
    });
    c.perKeyRgb = configurable('mirror', true, this.spec.evidence, {
      safety: SafetyLevel.SAFE_VOLATILE,
      source: this.spec.source,
      value: `${this.layout.keys.filter((k) => k.light !== null).length} keys`,
      note,
    });
    for (const f of ['keymap', 'macros'] as const)
      c[f] = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
        confidence: Evidence.UNKNOWN,
        note: 'Only the lighting protocol of this keyboard is public.',
      });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      model: this.spec.model,
      profileId: this.key.replace('/', '-'),
      identity: this.group.identity,
      firmware: {
        version: null,
        source: 'not reported by this protocol',
        confidence: Evidence.UNKNOWN,
      },
      transport: this.transport,
      protocol: { id: this.spec.protocolId, name: this.spec.protocolName },
      battery: null,
      fields: [],
    };
  }

  override getRgbEffects(): EffectCatalog {
    const none = { color: false, colorful: false, brightness: false, speed: false, direction: [] };
    return {
      effects: [
        ...(this.spec.canRelease
          ? [{ id: DirectEffect.KEYBOARD, name: 'Keyboard’s own lighting', controls: none }]
          : []),
        {
          id: DirectEffect.SOLID,
          name: 'Solid colour',
          controls: { ...none, color: true, brightness: true },
        },
        { id: DirectEffect.PER_KEY, name: 'Per-key colours', controls: none },
      ],
      brightness: { min: 0, max: 10 },
      speed: { min: 0, max: 0 },
      customEffect: DirectEffect.PER_KEY,
    };
  }

  private async mirror(): Promise<Mirror> {
    return (
      (await this.opts.store.get<Mirror>(this.key)) ?? {
        rgb: {
          effect: this.spec.canRelease ? DirectEffect.KEYBOARD : DirectEffect.SOLID,
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

  private async show(colorOf: (i: number) => Rgb): Promise<void> {
    if (!this.controlled) {
      await this.takeControl();
      this.controlled = true;
    }
    await this.sendFrame(this.spec.leds.map((_, i) => colorOf(i)));
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    return (await this.mirror()).rgb;
  }

  override async setRgbConfig(c: RgbConfig): Promise<void> {
    const m = await this.mirror();
    if (c.effect === DirectEffect.KEYBOARD && this.spec.canRelease) {
      await this.releaseControl();
      this.controlled = false;
    } else if (c.effect === DirectEffect.SOLID) {
      const k = Math.max(0, Math.min(10, c.brightness)) / 10;
      const col = {
        r: Math.round(c.color.r * k),
        g: Math.round(c.color.g * k),
        b: Math.round(c.color.b * k),
      };
      await this.show((i) => (this.spec.leds[i] ? col : { r: 0, g: 0, b: 0 }));
    } else if (c.effect === DirectEffect.PER_KEY) {
      await this.show((i) => m.perKey[i] ?? { r: 0, g: 0, b: 0 });
    } else throw new ProtocolError(`Effect ${c.effect} is not offered.`);
    await this.opts.store.set(this.key, { ...m, rgb: c });
  }

  override async getPerKeyRgb(): Promise<PerKeyRgb> {
    return (await this.mirror()).perKey;
  }

  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    await this.show((i) => colors[i] ?? { r: 0, g: 0, b: 0 });
    const m = await this.mirror();
    await this.opts.store.set(this.key, {
      perKey: colors,
      rgb: { ...m.rgb, effect: DirectEffect.PER_KEY },
    });
  }
}

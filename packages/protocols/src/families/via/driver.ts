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
  layerIdAt,
  layerIndex,
} from '@openkey/core';
import type {
  Capabilities,
  DeviceInfo,
  EffectCatalog,
  KeyAction,
  KeyActionKind,
  KeyboardLayout,
  KeymapState,
  LayerId,
  Macro,
  MacroLimits,
  RgbConfig,
  StateStore,
  TransportMode,
} from '@openkey/core';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import { Channel, KEYCODES_V2_FROM, LightValue, VIA_PROTOCOL_ID } from './constants.js';
import type { LightingChannel } from './constants.js';
import { gridDefinition } from './definition.js';
import type { ViaDefinition } from './definition.js';
import { decodeKeycode, encodeKeycode, offeredSpecials } from './keycodes.js';
import type { KeycodeVersion } from './keycodes.js';
import {
  CHANNEL_NAME,
  hasColor,
  hasSpeed,
  hsToRgb,
  rgbToHs,
  viaEffectCatalog,
} from './lighting.js';
import { decodeMacros, encodeMacros } from './macros.js';
import { ViaSession } from './session.js';

const hex4 = (n: number) => n.toString(16).padStart(4, '0');
export const definitionKey = (vendorId: number, productId: number): string =>
  `via/definition/${hex4(vendorId)}:${hex4(productId)}`;

export interface ViaDriverOptions {
  store: StateStore;
  open: (iface: HidInterfaceInfo) => Promise<HidTransport>;
}

/**
 * VIA driver: QMK keyboards with VIA (and Vial) firmware. Keymaps, macros and lighting are read from
 * the keyboard, so every write is checked by reading it back. The physical layout comes from a
 * definition file the user loads once per keyboard model (kept in the browser), or a matrix grid.
 */
export class ViaDriver extends BaseKeyboardDriver {
  readonly protocolId = VIA_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: ViaSession | null = null;
  protocolVersion = 0;
  firmwareVersion: number | null = null;
  layers = 0;
  definition: ViaDefinition | null = null;
  channel: LightingChannel | null = null;
  private macroCount = 0;
  private macroSize = 0;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    private readonly opts: ViaDriverOptions,
  ) {
    super();
    this.transport = group.transportHint;
  }

  get keycodeVersion(): KeycodeVersion {
    return this.protocolVersion >= KEYCODES_V2_FROM ? 2 : 1;
  }

  /** True until a definition or matrix size is known: the editor must ask for one first. */
  get needsDefinition(): boolean {
    return !this.definition;
  }

  private s(): ViaSession {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  async connect(): Promise<void> {
    this.session = new ViaSession(await this.opts.open(this.iface));
    const s = this.session;
    this.protocolVersion = await s.protocolVersion();
    this.firmwareVersion = await s.firmwareVersion().catch(() => null);
    this.layers = await s.layerCount();
    const id = this.group.identity;
    this.definition =
      (await this.opts.store.get<ViaDefinition>(definitionKey(id.vendorId, id.productId))) ?? null;
    for (const c of [
      Channel.RGB_MATRIX,
      Channel.RGBLIGHT,
      Channel.LED_MATRIX,
      Channel.BACKLIGHT,
    ] as const) {
      if ((await s.getValue(c, LightValue.BRIGHTNESS)) !== null) {
        this.channel = c;
        break;
      }
    }
    this.macroCount = await s.macroCount();
    this.macroSize = this.macroCount ? await s.macroBufferSize() : 0;
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.transport.close().catch(() => undefined);
  }

  /**
   * Saves a definition for this keyboard model. It applies from the next connection, so a session
   * that is being replaced never starts reading with a layout it was not opened with.
   */
  async setDefinition(def: ViaDefinition): Promise<void> {
    const id = this.group.identity;
    await this.opts.store.set(definitionKey(id.vendorId, id.productId), def);
  }

  /** Uses a plain rows × columns grid when no definition file is available. */
  async useGrid(rows: number, cols: number): Promise<void> {
    if (!(rows >= 1 && rows <= 32 && cols >= 1 && cols <= 32))
      throw new ProtocolError('Rows and columns must be 1–32.');
    await this.setDefinition(
      gridDefinition(rows, cols, this.group.identity.productName || 'VIA keyboard'),
    );
  }

  async forgetDefinition(): Promise<void> {
    const id = this.group.identity;
    await this.opts.store.delete(definitionKey(id.vendorId, id.productId));
  }

  getLayout(): KeyboardLayout {
    return (
      this.definition?.layout ?? {
        id: 'via-unknown',
        name: 'Layout not loaded',
        width: 1,
        height: 1,
        keys: [],
        source: 'no definition loaded',
      }
    );
  }

  override getLayerIds(): readonly LayerId[] {
    return Array.from({ length: Math.max(1, this.layers) }, (_, i) => layerIdAt(i));
  }

  override getKeyActionKinds(): readonly KeyActionKind[] {
    return [
      'disabled',
      'keyboard',
      'consumer',
      'system',
      'mouse',
      'layer',
      'special',
      ...(this.macroCount ? (['macro'] as const) : []),
    ];
  }

  override getSpecialActions(): readonly { code: number; label: string }[] {
    return offeredSpecials(this.keycodeVersion);
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const S = Evidence.OBSERVED;
    const src = 'VIA protocol (QMK quantum/via.c)';
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.VERIFIED,
      source: 'VIA protocol and firmware version',
    });
    const keymapNote = this.definition
      ? 'Read from the keyboard; every change is read back.'
      : 'Load the keyboard’s VIA definition (or choose a matrix grid) to edit the keymap.';
    c.keymap = configurable('device', true, S, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: src,
      note: keymapNote,
    });
    c.fnLayer =
      this.layers > 1
        ? configurable('device', true, S, {
            safety: SafetyLevel.SAFE_PERSISTENT,
            source: src,
            value: `${this.layers} layers`,
          })
        : feature(FeatureStatus.NOT_SUPPORTED, {
            confidence: Evidence.VERIFIED,
            note: 'The firmware reports one layer.',
          });
    c.macros = this.macroCount
      ? configurable('device', true, S, {
          safety: SafetyLevel.SAFE_PERSISTENT,
          source: src,
          value: `${this.macroCount} macros, ${this.macroSize} bytes`,
        })
      : feature(FeatureStatus.NOT_SUPPORTED, {
          confidence: Evidence.VERIFIED,
          note: 'The firmware has no dynamic macros.',
        });
    c.rgb = this.channel
      ? configurable('device', true, S, {
          safety: SafetyLevel.SAFE_PERSISTENT,
          source: src,
          value: CHANNEL_NAME[this.channel],
        })
      : feature(FeatureStatus.NOT_SUPPORTED, {
          confidence: Evidence.OBSERVED,
          note: 'No QMK lighting channel answered.',
        });
    c.factoryDefaults = feature(FeatureStatus.NOT_SUPPORTED, {
      confidence: S,
      note: 'VIA can reset the keymap and EEPROM; OpenKey does not send those commands. Use a backup instead.',
    });
    c.firmware = feature(FeatureStatus.NOT_SUPPORTED, {
      confidence: S,
      note: 'Bootloader entry exists in VIA; OpenKey never sends it.',
    });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const id = this.group.identity;
    const v = this.protocolVersion;
    return {
      model:
        this.definition && this.definition.format !== 'grid'
          ? this.definition.name
          : id.productName || 'QMK keyboard',
      profileId: `via-${hex4(id.vendorId)}-${hex4(id.productId)}`,
      identity: id,
      firmware: {
        version: this.firmwareVersion ? `0x${this.firmwareVersion.toString(16)}` : null,
        source: 'VIA id_firmware_version (set by the keyboard maker; 0 when unset)',
        confidence: Evidence.VERIFIED,
      },
      transport: this.transport,
      protocol: {
        id: this.protocolId,
        name: 'VIA (QMK raw HID)',
        revision: `0x${v.toString(16).padStart(4, '0')}`,
      },
      battery: null,
      fields: [
        {
          key: 'viaProtocol',
          label: 'VIA protocol',
          value: `0x${v.toString(16).padStart(4, '0')} (keycodes v${this.keycodeVersion})`,
          confidence: Evidence.VERIFIED,
          source: 'id_get_protocol_version',
        },
        {
          key: 'layers',
          label: 'Layers',
          value: this.layers,
          confidence: Evidence.VERIFIED,
          source: 'id_dynamic_keymap_get_layer_count',
        },
        {
          key: 'matrix',
          label: 'Matrix',
          value: this.definition
            ? `${this.definition.rows} × ${this.definition.cols}`
            : 'needs a definition',
          confidence: this.definition ? Evidence.OBSERVED : Evidence.UNKNOWN,
          source: this.definition?.layout.source ?? '—',
        },
        {
          key: 'lighting',
          label: 'Lighting',
          value: this.channel ? CHANNEL_NAME[this.channel] : 'none',
          confidence: Evidence.VERIFIED,
          source: 'id_custom_get_value',
        },
        {
          key: 'macros',
          label: 'Macros',
          value: this.macroCount ? `${this.macroCount} (${this.macroSize} bytes)` : 'none',
          confidence: Evidence.VERIFIED,
          source: 'id_dynamic_keymap_macro_get_count',
        },
      ],
    };
  }

  private requireMatrix(): ViaDefinition {
    if (!this.definition)
      throw new ProtocolError(
        'Load the keyboard’s VIA definition (or choose a matrix grid) first.',
      );
    return this.definition;
  }

  private async readLayer(layer: number): Promise<Uint16Array> {
    const d = this.requireMatrix();
    const n = d.rows * d.cols;
    if (layer < 0 || layer >= this.layers)
      throw new ProtocolError(`Layer ${layer} does not exist (the keyboard has ${this.layers}).`);
    // The bulk read takes an absolute offset into the whole keymap buffer.
    const out = new Uint16Array(n);
    const buf = await this.s().readKeymapBuffer(layer * n * 2, n * 2);
    for (let i = 0; i < n; i++) out[i] = (buf[i * 2]! << 8) | buf[i * 2 + 1]!;
    return out;
  }

  override async getKeymap(layer: LayerId = 'base'): Promise<KeymapState> {
    const codes = await this.readLayer(layerIndex(layer));
    const slots: Record<number, KeyAction> = {};
    for (const k of this.requireMatrix().layout.keys)
      slots[k.slot] = decodeKeycode(codes[k.slot] ?? 0, this.keycodeVersion);
    return { layer, slots, provenance: 'device', updatedAt: new Date().toISOString() };
  }

  override async setKeymap(state: KeymapState): Promise<void> {
    const d = this.requireMatrix();
    const L = layerIndex(state.layer);
    const before = await this.readLayer(L);
    const s = this.s();
    const changes: [number, number][] = [];
    for (const [slotStr, action] of Object.entries(state.slots)) {
      const slot = Number(slotStr);
      if (action.kind === 'default') continue;
      const code = encodeKeycode(action, this.keycodeVersion);
      if (before[slot] !== code) changes.push([slot, code]);
    }
    for (const [slot, code] of changes)
      await s.setKeycode(L, Math.floor(slot / d.cols), slot % d.cols, code);
    if (!changes.length) return;
    const after = await this.readLayer(L);
    const wrong = changes.filter(([slot, code]) => after[slot] !== code);
    if (wrong.length)
      throw new ReadbackMismatchError(`${wrong.length} key(s) did not keep their new keycode.`, {
        slots: wrong.map(([sl]) => sl),
      });
  }

  override async getFnLayers(): Promise<KeymapState[]> {
    const out: KeymapState[] = [];
    for (let i = 1; i < this.layers; i++) out.push(await this.getKeymap(layerIdAt(i)));
    return out;
  }

  override async setFnLayers(layers: KeymapState[]): Promise<void> {
    for (const l of layers) await this.setKeymap(l);
  }

  override getMacroLimits(): MacroLimits {
    return {
      slots: this.macroCount,
      storageBytes: this.macroSize,
      minDelayMs: 1,
      maxDelayMs: 60000,
    };
  }

  override async getMacros(): Promise<Macro[]> {
    if (!this.macroCount) return [];
    return decodeMacros(
      await this.s().readMacroBuffer(this.macroSize),
      this.macroCount,
      this.keycodeVersion,
    );
  }

  override async setMacros(macros: Macro[]): Promise<void> {
    const buf = encodeMacros(macros, this.macroCount, this.macroSize, this.keycodeVersion);
    await this.s().writeMacroBuffer(buf);
    const back = await this.s().readMacroBuffer(this.macroSize);
    if (back.some((b, i) => b !== buf[i]))
      throw new ReadbackMismatchError('The keyboard did not keep the macro buffer.');
  }

  private requireChannel(): LightingChannel {
    if (!this.channel) throw new ProtocolError('This firmware has no VIA lighting channel.');
    return this.channel;
  }

  override getRgbEffects(): EffectCatalog {
    return viaEffectCatalog(this.requireChannel());
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    const c = this.requireChannel();
    const s = this.s();
    const brightness = (await s.getValue(c, LightValue.BRIGHTNESS))?.[0] ?? 0;
    const effect = (await s.getValue(c, LightValue.EFFECT))?.[0] ?? 0;
    const speed = hasSpeed(c) ? ((await s.getValue(c, LightValue.SPEED))?.[0] ?? 0) : 0;
    const hs = hasColor(c) ? await s.getValue(c, LightValue.COLOR, 2) : null;
    return {
      effect,
      brightness,
      speed,
      color: hs ? hsToRgb(hs[0]!, hs[1]!) : { r: 255, g: 255, b: 255 },
      colorful: false,
      direction: 'right',
    };
  }

  override async setRgbConfig(config: RgbConfig): Promise<void> {
    const c = this.requireChannel();
    const s = this.s();
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    await s.setValue(c, LightValue.EFFECT, [clamp(config.effect)]);
    await s.setValue(c, LightValue.BRIGHTNESS, [clamp(config.brightness)]);
    if (hasSpeed(c)) await s.setValue(c, LightValue.SPEED, [clamp(config.speed)]);
    if (hasColor(c)) await s.setValue(c, LightValue.COLOR, rgbToHs(config.color));
    await s.save(c);
    const back = await this.getRgbConfig();
    if (back.effect !== clamp(config.effect))
      throw new ReadbackMismatchError(
        `The keyboard reports effect ${back.effect} after OpenKey set ${config.effect}; this firmware may not include that effect.`,
      );
  }
}

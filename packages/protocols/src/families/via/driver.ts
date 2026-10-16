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
import {
  Channel,
  KEYCODES_V2_FROM,
  KeyboardValue,
  LightValue,
  VIA_PROTOCOL_ID,
} from './constants.js';
import type { LightingChannel } from './constants.js';
import {
  encoderOfSlot,
  gridDefinition,
  unpackLayoutOptions,
  withLayoutOptions,
} from './definition.js';
import type { ViaDefinition } from './definition.js';
import { controlBytes } from './menus.js';
import type { CustomMenu, MenuControl } from './menus.js';
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
import {
  QMK_SETTINGS,
  VIAL_SERIAL_MAGIC,
  getCombo,
  getKeyOverride,
  getTapDance,
  qmkSettingGet,
  qmkSettingIds,
  qmkSettingSet,
  setCombo,
  setKeyOverride,
  setTapDance,
  vialCounts,
  vialDefinition,
  vialKeyboardId,
} from './vial.js';
import type {
  Combo,
  KeyOverride,
  QmkSettingField,
  TapDance,
  VialCounts,
  VialInfo,
} from './vial.js';

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
  /** Set when the keyboard answered as Vial (its definition was read from it). */
  vial: VialInfo | null = null;
  /** Vial extras the firmware has: QMK setting ids and dynamic-entry counts. */
  vialFeatures: { settings: number[]; counts: VialCounts } | null = null;
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
    // Vial boards carry their own definition. The USB serial marks them, where the platform shows
    // it (node-hid, Linux sysfs); in the browser the user asks for it (readVialDefinition).
    if (!this.definition && id.serialNumber?.includes(VIAL_SERIAL_MAGIC))
      await this.readVialDefinition()
        .then((d) => (this.definition = d))
        .catch(() => undefined);
    // Layout options the user did not choose here come from the keyboard's own stored value.
    const def = this.definition;
    if (def?.options?.length && !def.choices?.length) {
      const stored = await s.keyboardValue(KeyboardValue.LAYOUT_OPTIONS).catch(() => null);
      if (stored !== null)
        this.definition = withLayoutOptions(def, unpackLayoutOptions(stored, def.options));
    }
    // A board whose layout came from its Vial firmware answers Vial again: read what it offers.
    if (this.definition?.vial) await this.loadVialFeatures().catch(() => undefined);
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

  /**
   * Asks the keyboard for its Vial definition (read-only Vial commands FE 00–02). Returns the parsed
   * definition, with this keyboard's USB identity; throws when the firmware is not Vial.
   */
  async readVialDefinition(): Promise<ViaDefinition> {
    const s = this.s();
    const info = await vialKeyboardId(s);
    if (!info) throw new ProtocolError('This keyboard does not run Vial firmware.');
    this.vial = info;
    const def = await vialDefinition(s);
    const id = this.group.identity;
    return { ...def, vendorId: id.vendorId, productId: id.productId, vial: true };
  }

  private async loadVialFeatures(): Promise<void> {
    const s = this.s();
    this.vial ??= await vialKeyboardId(s);
    if (!this.vial) return;
    this.vialFeatures = { settings: await qmkSettingIds(s), counts: await vialCounts(s) };
  }

  /** The QMK settings OpenKey can show that this firmware has. */
  qmkSettingFields(): QmkSettingField[] {
    const ids = new Set(this.vialFeatures?.settings ?? []);
    return QMK_SETTINGS.flatMap((g) => g.fields).filter((f) => ids.has(f.id));
  }

  /** Raw values by setting id (flags are bits of one value). */
  async readQmkSettings(): Promise<Record<number, number>> {
    const out: Record<number, number> = {};
    for (const f of this.qmkSettingFields()) {
      if (f.id in out) continue;
      const v = await qmkSettingGet(this.s(), f.id, f.width);
      if (v !== null) out[f.id] = v;
    }
    return out;
  }

  /** Writes changed setting values, then reads them back. */
  async writeQmkSettings(values: Record<number, number>): Promise<void> {
    const width = new Map(this.qmkSettingFields().map((f) => [f.id, f.width]));
    for (const [idStr, v] of Object.entries(values)) {
      const id = Number(idStr);
      const w = width.get(id);
      if (!w) throw new ProtocolError(`QMK setting ${id} is not offered by this keyboard.`);
      await qmkSettingSet(this.s(), id, w, v);
      const back = await qmkSettingGet(this.s(), id, w);
      if (back !== v) throw new ReadbackMismatchError(`QMK setting ${id} did not keep its value.`);
    }
  }

  async readTapDances(): Promise<TapDance[]> {
    const n = this.vialFeatures?.counts.tapDance ?? 0;
    const out: TapDance[] = [];
    for (let i = 0; i < n; i++) out.push(await getTapDance(this.s(), i));
    return out;
  }

  async readCombos(): Promise<Combo[]> {
    const n = this.vialFeatures?.counts.combos ?? 0;
    const out: Combo[] = [];
    for (let i = 0; i < n; i++) out.push(await getCombo(this.s(), i));
    return out;
  }

  async readKeyOverrides(): Promise<KeyOverride[]> {
    const n = this.vialFeatures?.counts.keyOverrides ?? 0;
    const out: KeyOverride[] = [];
    for (let i = 0; i < n; i++) out.push(await getKeyOverride(this.s(), i));
    return out;
  }

  /** Writes one tap dance, combo or key override entry and reads it back. */
  async writeVialEntry(
    kind: 'tapDance' | 'combo' | 'keyOverride',
    index: number,
    entry: TapDance | Combo | KeyOverride,
  ): Promise<void> {
    const s = this.s();
    const [set, get] =
      kind === 'tapDance'
        ? [() => setTapDance(s, index, entry as TapDance), () => getTapDance(s, index)]
        : kind === 'combo'
          ? [() => setCombo(s, index, entry as Combo), () => getCombo(s, index)]
          : [() => setKeyOverride(s, index, entry as KeyOverride), () => getKeyOverride(s, index)];
    await set();
    const back = await get();
    if (JSON.stringify(back) !== JSON.stringify(entry))
      throw new ReadbackMismatchError(`The keyboard did not keep ${kind} ${index}.`);
  }

  /** QMK keycode ↔ key action, for editors that store keycodes (Vial entries). */
  decodeKey(code: number): KeyAction {
    return decodeKeycode(code, this.keycodeVersion);
  }

  encodeKey(action: KeyAction): number {
    return encodeKeycode(action, this.keycodeVersion);
  }

  /** The custom menus of the loaded definition. */
  getMenus(): readonly CustomMenu[] {
    return this.definition?.menus ?? [];
  }

  private menuControls(): MenuControl[] {
    return this.getMenus().flatMap((m) =>
      m.sections.flatMap((s) => s.controls.filter((c) => c.command && c.type !== 'button')),
    );
  }

  /** Reads every bound control; the result is keyed by token. Controls the firmware ignores are left out. */
  async readMenuValues(): Promise<Record<string, number[]>> {
    const out: Record<string, number[]> = {};
    for (const c of this.menuControls()) {
      if (!c.token || out[c.token]) continue;
      const v = await this.s().getBound(c.command!, c.bytes);
      if (v) out[c.token] = v;
    }
    return out;
  }

  /**
   * Writes changed controls (token → raw bytes), saves each channel once, then reads the values back.
   * Buttons send their value and are not read back.
   */
  async writeMenuValues(values: Record<string, number[]>): Promise<void> {
    const s = this.s();
    const all = this.getMenus().flatMap((m) => m.sections.flatMap((x) => x.controls));
    const channels = new Set<number>();
    const wrote: MenuControl[] = [];
    for (const [token, data] of Object.entries(values)) {
      const c = all.find((x) => x.token === token && x.command);
      if (!c) throw new ProtocolError(`The definition has no control ${token}.`);
      await s.setBound(c.command!, c.type === 'button' ? controlBytes(c, 0) : data);
      channels.add(c.command![0]!);
      if (c.type !== 'button') wrote.push(c);
    }
    for (const ch of channels) await s.save(ch);
    for (const c of wrote) {
      const back = await s.getBound(c.command!, c.bytes);
      const want = values[c.token!]!;
      if (back && want.some((b, i) => back[i] !== b))
        throw new ReadbackMismatchError(`${c.label} did not keep its new value.`);
    }
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
    const tapDances =
      this.keycodeVersion === 2
        ? Array.from({ length: this.vialFeatures?.counts.tapDance ?? 0 }, (_, i) => ({
            code: 0x5700 | i,
            label: `Tap dance ${i}`,
          }))
        : [];
    return [...offeredSpecials(this.keycodeVersion), ...tapDances];
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
    if (this.definition?.encoders)
      c.encoder = configurable('device', true, S, {
        safety: SafetyLevel.SAFE_PERSISTENT,
        source: 'VIA id_dynamic_keymap_get/set_encoder',
        value: `${this.definition.encoders} knob(s): turn left / right on every layer`,
        note: 'Shown as ↺ / ↻ keys on the knob in the keymap; needs firmware with an encoder map.',
      });
    if (this.definition?.menus?.length)
      c.customMenus = configurable('device', true, S, {
        safety: SafetyLevel.SAFE_PERSISTENT,
        source: 'VIA id_custom_get/set_value and id_custom_save, as the definition declares them',
        value: this.definition.menus.map((m) => m.label).join(', '),
        note: 'Controls come from the keyboard’s definition; every change is read back.',
      });
    const vf = this.vialFeatures;
    if (vf && this.qmkSettingFields().length)
      c.firmwareSettings = configurable('device', true, S, {
        safety: SafetyLevel.SAFE_PERSISTENT,
        source: 'Vial QMK settings (vial_qmk_settings_get/set)',
        value: `${this.qmkSettingFields().length} settings`,
        note: 'Tap-hold timing, Auto Shift, modifier swaps and more; every change is read back.',
      });
    if (vf && vf.counts.tapDance + vf.counts.combos + vf.counts.keyOverrides > 0)
      c.advancedKeys = configurable('device', true, S, {
        safety: SafetyLevel.SAFE_PERSISTENT,
        source: 'Vial dynamic entries (tap dance, combos, key overrides)',
        value: `${vf.counts.tapDance} tap dances, ${vf.counts.combos} combos, ${vf.counts.keyOverrides} key overrides`,
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

  /** Encoder keycodes for the knobs the layout shows; slots whose firmware has no encoder map are left out. */
  private async readEncoders(layer: number): Promise<Map<number, number>> {
    const d = this.requireMatrix();
    const out = new Map<number, number>();
    for (const k of d.layout.keys) {
      const e = encoderOfSlot(d.rows, d.cols, k.slot);
      if (!e) continue;
      const code = await this.s().getEncoder(layer, e.index, e.clockwise);
      if (code !== null) out.set(k.slot, code);
    }
    return out;
  }

  override async getKeymap(layer: LayerId = 'base'): Promise<KeymapState> {
    const L = layerIndex(layer);
    const codes = await this.readLayer(L);
    const d = this.requireMatrix();
    const enc = d.encoders ? await this.readEncoders(L) : new Map<number, number>();
    const slots: Record<number, KeyAction> = {};
    for (const k of d.layout.keys) {
      const code = encoderOfSlot(d.rows, d.cols, k.slot) ? enc.get(k.slot) : codes[k.slot];
      if (code !== undefined) slots[k.slot] = decodeKeycode(code, this.keycodeVersion);
    }
    return { layer, slots, provenance: 'device', updatedAt: new Date().toISOString() };
  }

  override async setKeymap(state: KeymapState): Promise<void> {
    const d = this.requireMatrix();
    const L = layerIndex(state.layer);
    const before = await this.readLayer(L);
    const encBefore = d.encoders ? await this.readEncoders(L) : new Map<number, number>();
    const s = this.s();
    const changes: [number, number][] = [];
    for (const [slotStr, action] of Object.entries(state.slots)) {
      const slot = Number(slotStr);
      if (action.kind === 'default') continue;
      const code = encodeKeycode(action, this.keycodeVersion);
      const was = encoderOfSlot(d.rows, d.cols, slot) ? encBefore.get(slot) : before[slot];
      if (was !== undefined && was !== code) changes.push([slot, code]);
    }
    for (const [slot, code] of changes) {
      const e = encoderOfSlot(d.rows, d.cols, slot);
      if (e) await s.setEncoder(L, e.index, e.clockwise, code);
      else await s.setKeycode(L, Math.floor(slot / d.cols), slot % d.cols, code);
    }
    if (!changes.length) return;
    const after = await this.readLayer(L);
    const encAfter = d.encoders ? await this.readEncoders(L) : new Map<number, number>();
    const wrong = changes.filter(
      ([slot, code]) =>
        (encoderOfSlot(d.rows, d.cols, slot) ? encAfter.get(slot) : after[slot]) !== code,
    );
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

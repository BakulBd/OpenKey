import {
  BaseKeyboardDriver,
  Evidence,
  FeatureStatus,
  ProtocolError,
  ReadbackMismatchError,
  SafetyLevel,
  UnsupportedFeatureError,
  configurable,
  emptyCapabilities,
  feature,
  toHex,
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
  PerKeyRgb,
  RgbConfig,
  SettingsSchema,
  StateStore,
  SystemSettings,
  TransportMode,
} from '@openkey/core';
import { getLayout } from '@openkey/devices';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import { BY_TECH_PROTOCOL_ID, Cmd, screenParams } from './constants.js';
import { AULA_SLEEP, SELF_DEFINE, effectCatalog, identityHex } from './models.js';
import {
  COLOR_BYTES,
  MATRIX_BYTES,
  MATRIX_LAYERS,
  MatrixCmd,
  SPECIAL_ACTIONS,
  decodeAction,
  encodeAction,
  factoryCodes,
  isFnCode,
  matrixParameter,
  patchColors,
  readColors,
  readMatrix,
  writeMatrix,
} from './matrix.js';
import type { ByTechModel } from './models.js';
import {
  COLOR_CYCLE,
  FIRMWARE_COLORS,
  assertValidPage,
  diffPages,
  isValidPage,
  nearestFirmwareColor,
  patchPage,
  readSlot,
} from './page.js';
import { BY_TECH_LAYOUT } from './page.js';
import type { PageLayout } from './page.js';
import { ByTechSession } from './session.js';
import type { ByTechSessionOptions } from './session.js';
import { rkByTechLayout, rkFactory } from './rkkeys.js';
import type { RkByTechKeys } from './rkkeys.js';
import { rkWebFactory, rkWebLayout } from './rkweb.js';
import type { RkWebBoard } from './rkweb.js';

/** Where a settings-page layout confirmed by the owner's own key presses is kept (per model code). */
export const learnedLayoutKey = (identity: Uint8Array): string =>
  `by-tech/layout/${identityHex(identity).replace(/ /g, '')}`;

export interface LearnedLayout extends PageLayout {
  /** ISO date of the confirmation; the evidence is the owner's key press observed by a read. */
  confirmedAt: string;
}

export interface ByTechDriverOptions extends ByTechSessionOptions {
  /** RK's key table for the model, when it has one (`ByTechModel.rkKeys`). */
  rkKeys?: RkByTechKeys | null;
  /** The board's entry in RK's web driver, when it has one (factory tables of every layer). */
  rkWeb?: RkWebBoard | null;
  store: StateStore;
  open: (iface: HidInterfaceInfo) => Promise<HidTransport>;
}

/**
 * Driver for the BY Tech OEM protocol. Lighting and sleep are read from the keyboard's own settings
 * page and written back with only the changed bytes patched; every write is followed by a read-back.
 * Models whose page layout is unknown are read-only until the owner confirms the layout by pressing
 * the keyboard's own lighting shortcuts (see `learnLayout`).
 */
export class ByTechDriver extends BaseKeyboardDriver {
  readonly protocolId = BY_TECH_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: ByTechSession | null = null;
  private learned: LearnedLayout | null = null;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    private readonly reportId: number,
    readonly identity: Uint8Array,
    readonly model: ByTechModel | null,
    private readonly opts: ByTechDriverOptions,
  ) {
    super();
    this.transport = group.transportHint;
  }

  async connect(): Promise<void> {
    const t = await this.opts.open(this.iface);
    this.session = new ByTechSession(t, this.reportId, this.opts);
    if (!this.model?.pageLayout)
      this.learned =
        (await this.opts.store.get<LearnedLayout>(learnedLayoutKey(this.identity))) ?? null;
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.transport.close().catch(() => undefined);
  }

  private s(): ByTechSession {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  /** The page layout in force: the model's documented one, or the one the owner confirmed. */
  get layout(): PageLayout | null {
    return this.model?.pageLayout ?? this.learned;
  }

  /** True when the layout comes from the owner's confirmation rather than the model table. */
  get layoutLearned(): boolean {
    return !this.model?.pageLayout && !!this.learned;
  }

  get displayName(): string {
    return this.model
      ? `${this.model.brand} ${this.model.model}`
      : this.group.identity.productName || 'BY Tech keyboard';
  }

  private cachedLayout: KeyboardLayout | null = null;

  getLayout(): KeyboardLayout {
    this.cachedLayout ??= this.buildLayout();
    return this.cachedLayout;
  }

  private buildLayout(): KeyboardLayout {
    const id = `by-tech-${this.group.identity.productId.toString(16).padStart(4, '0')}`;
    if (this.model?.layoutId === 'rk-web' && this.opts.rkWeb)
      return rkWebLayout(id, this.displayName, this.opts.rkWeb);
    if (this.model?.layoutId === 'rk-keys' && this.opts.rkKeys)
      return rkByTechLayout(id, this.displayName, this.opts.rkKeys);
    const fixed = this.model?.layoutId;
    return getLayout(fixed && fixed !== 'rk-web' && fixed !== 'rk-keys' ? fixed : 'ak820-pro');
  }

  /** Key maps and per-key colours: a matrix-indexed layout, over the cable. */
  private get matrix(): boolean {
    if (this.model?.layoutId === 'rk-web' && !this.opts.rkWeb) return false;
    if (this.model?.layoutId === 'rk-keys' && !this.opts.rkKeys) return false;
    return !!this.model?.matrix && this.transport === 'usb';
  }

  /** Factory codes of a layer: RK's own tables when known, else the layout's base-layer usages. */
  private factory(layer: number): Map<number, number> {
    if (this.opts.rkWeb) return rkWebFactory(this.opts.rkWeb, layer);
    if (this.opts.rkKeys) return rkFactory(this.opts.rkKeys, layer);
    return layer === 0 ? factoryCodes(this.getLayout()) : new Map();
  }

  private requireMatrix(): void {
    if (!this.matrix)
      throw new ProtocolError('Key maps and per-key colours are not available for this keyboard.');
  }

  private layerIndex(layer: LayerId): number {
    const i = (MATRIX_LAYERS as Record<string, number>)[layer];
    if (i === undefined) throw new ProtocolError(`Layer ${layer} does not exist on this keyboard.`);
    return i;
  }

  private async readCodes(layer: number): Promise<number[]> {
    return readMatrix(
      await this.s().read(MatrixCmd.GET_KEY_MATRIX, matrixParameter(layer), MATRIX_BYTES),
    );
  }

  override getLayerIds(): readonly LayerId[] {
    return this.matrix ? ['base', 'fn', 'layer2'] : ['base'];
  }

  override getLayerLabel(layer: LayerId): string | undefined {
    return layer === 'fn' ? 'FN1 layer' : layer === 'layer2' ? 'FN2 layer' : undefined;
  }

  override getKeyActionKinds(): readonly KeyActionKind[] {
    return this.matrix
      ? ['default', 'disabled', 'keyboard', 'consumer', 'mouse', 'special']
      : super.getKeyActionKinds();
  }

  override getSpecialActions(): readonly { code: number; label: string }[] {
    return this.matrix ? SPECIAL_ACTIONS : [];
  }

  /** The layer as the keyboard holds it, every key decoded. */
  override async getKeymap(layer: LayerId = 'base'): Promise<KeymapState> {
    this.requireMatrix();
    const codes = await this.readCodes(this.layerIndex(layer));
    const slots: Record<number, KeyAction> = {};
    for (const k of this.getLayout().keys)
      if (k.slot >= 0) slots[k.slot] = decodeAction(codes[k.slot]!);
    return { layer, slots, provenance: 'device' };
  }

  override async getFnLayer(): Promise<KeymapState> {
    return this.getKeymap('fn');
  }

  override async setFnLayer(state: KeymapState): Promise<void> {
    await this.setKeymap({ ...state, layer: 'fn' });
  }

  /**
   * Reads the layer, changes the given keys, writes the whole layer and reads it again. Fn keys
   * are never changed; "default" is the key's factory function as RK's own table lists it.
   */
  override async setKeymap(state: KeymapState): Promise<void> {
    this.requireMatrix();
    const layer = this.layerIndex(state.layer);
    const current = await this.readCodes(layer);
    const factory = this.factory(layer);
    const next = current.slice();
    for (const [k, action] of Object.entries(state.slots)) {
      const slot = Number(k);
      if (!Number.isInteger(slot) || slot < 0 || slot >= current.length)
        throw new ProtocolError(`Key ${k} is outside the keyboard’s matrix.`);
      let code: number;
      if (action.kind === 'default') {
        const f = factory.get(slot);
        if (f === undefined)
          throw new ProtocolError(
            layer === 0
              ? 'This key’s factory function is not known; choose a function for it.'
              : 'The factory function of this key on this FN layer is not known; choose a function for it.',
          );
        code = f;
      } else code = encodeAction(action, current[slot]!);
      if (code === current[slot]) continue;
      if (isFnCode(current[slot]!))
        throw new ProtocolError('Fn keys are not changed: they open the keyboard’s other layers.');
      next[slot] = code;
    }
    if (next.every((c, i) => c === current[i])) return;
    const param = matrixParameter(layer);
    await this.s().write(MatrixCmd.SET_KEY_MATRIX, param, writeMatrix(next));
    const back = await this.readCodes(layer);
    const off = next.flatMap((c, i) => (back[i] === c ? [] : [i]));
    if (off.length)
      throw new ReadbackMismatchError(`The keyboard did not keep ${off.length} key(s).`, {
        keys: off,
      });
  }

  override async getPerKeyRgb(): Promise<PerKeyRgb> {
    this.requireMatrix();
    const colors = readColors(await this.s().read(MatrixCmd.GET_LED_COLORS, 0, COLOR_BYTES));
    const out: PerKeyRgb = {};
    for (const k of this.getLayout().keys) if (k.light !== null) out[k.light] = colors[k.light]!;
    return out;
  }

  /** Reads the colour table, patches it, writes it, reads it again, then selects the Custom effect. */
  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    this.requireMatrix();
    this.requireLayout();
    const current = await this.s().read(MatrixCmd.GET_LED_COLORS, 0, COLOR_BYTES);
    const next = patchColors(current, colors);
    await this.s().write(MatrixCmd.SET_LED_COLORS, 0, next);
    const back = await this.s().read(MatrixCmd.GET_LED_COLORS, 0, COLOR_BYTES);
    if (back.some((v, i) => v !== next[i]))
      throw new ReadbackMismatchError('The keyboard did not keep the per-key colours.');
    await this.patch({ effect: SELF_DEFINE });
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.VERIFIED,
      note: 'Model code read from the keyboard (GET_INFO).',
      source: 'GET_INFO 0x82/1 answered by this keyboard',
    });
    if (this.transport !== 'usb') {
      for (const f of ['rgb', 'sleep'] as const)
        c[f] = feature(FeatureStatus.TRANSPORT_LIMITED, {
          confidence: Evidence.INFERRED,
          note: 'Settings are written over the USB cable only.',
        });
      return c;
    }
    const layout = this.layout;
    // Third-party hardware evidence (F75) is INFERRED for OpenKey; a layout the owner confirmed on
    // this keyboard by its own key presses is OBSERVED. Both stay behind the experimental opt-in.
    const ev = this.layoutLearned ? Evidence.OBSERVED : Evidence.INFERRED;
    if (layout) {
      c.rgb = configurable('device', true, ev, {
        safety: SafetyLevel.SAFE_PERSISTENT,
        source: this.layoutLearned
          ? 'settings page; layout confirmed by your key presses'
          : this.model?.brand === 'RK'
            ? 'settings page: field layout from RK’s own web driver (BeiYing profile), the same as the page verified on an AULA F75'
            : 'settings page (leisiji/AulaSofwareLinux, verified on an AULA F75)',
        note: 'Read from the keyboard, patched, written back and read again to confirm.',
      });
      c.sleep =
        this.model?.effects === 'aula-fw24'
          ? configurable('device', true, ev, {
              safety: SafetyLevel.SAFE_PERSISTENT,
              source: 'settings page byte 0x18',
            })
          : feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, { confidence: Evidence.UNKNOWN });
    } else {
      c.rgb = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
        read: 'none',
        confidence: Evidence.INFERRED,
        note: 'The settings page is readable, but its layout is not confirmed for this model. Confirm it with your keyboard’s lighting shortcut (Lighting → Teach OpenKey).',
      });
    }
    const web =
      'RK’s own web driver (drive.rkgaming.com, protocol BeiYing): key matrix 0x83/0x03 and colour table 0x86/0x06';
    c.perKeyRgb =
      this.matrix && layout
        ? configurable('device', true, Evidence.INFERRED, {
            safety: SafetyLevel.SAFE_PERSISTENT,
            source: web,
            value: `${this.getLayout().keys.filter((k) => k.light !== null).length} keys`,
            note: 'Read from the keyboard, changed, written back and read again. Applying switches the lighting to the Custom effect (18).',
          })
        : feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
            confidence: Evidence.INFERRED,
            note: 'Per-key colours need this model’s LED map; not known yet.',
          });
    if (this.model?.screenClock) {
      c.tftClock = configurable('none', true, Evidence.INFERRED, {
        safety: SafetyLevel.SAFE_VOLATILE,
        source: 'SetScreenParam 0x0B (ElXreno/rk-m87-sync, tested on an M87 by the source)',
        note: 'The keyboard keeps no time of its own: set it after each connection. A browser cannot read the computer’s volume, so the screen shows 0 for it until RK’s software sends one.',
      });
      c.tft = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
        confidence: Evidence.INFERRED,
        note: 'Picture upload goes through a separate screen controller with its own checksums; documented from the vendor app but not tested, so not sent.',
      });
    }
    if (this.matrix) {
      const keys = {
        safety: SafetyLevel.CAUTION,
        source: web,
        note: 'Read from the keyboard; the whole layer is written back with your changes and read again. Fn keys stay as they are.',
      };
      c.keymap = configurable('device', true, Evidence.INFERRED, {
        ...keys,
        value: 'keys, keys with modifiers, media keys, mouse buttons, lighting keys, Win lock',
      });
      c.fnLayer = configurable('device', true, Evidence.INFERRED, {
        ...keys,
        value: 'FN1 and FN2 layers',
      });
    } else
      c.keymap = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
        confidence: Evidence.INFERRED,
        note: 'The key encoding is known (RK web driver), but this model’s key matrix positions are not.',
      });
    c.macros = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, { confidence: Evidence.INFERRED });
    c.factoryDefaults = feature(FeatureStatus.NOT_SUPPORTED, {
      confidence: Evidence.INFERRED,
      note: 'A reset command exists in the vendor driver; OpenKey does not send it.',
    });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const id = this.group.identity;
    const page = this.layout ? null : await this.readSettingsPage().catch(() => null);
    return {
      model: this.displayName,
      profileId: this.model
        ? `${this.model.brand}-${this.model.model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        : 'by-tech-generic',
      identity: id,
      firmware: {
        version: null,
        source: 'not reported by this protocol',
        confidence: Evidence.UNKNOWN,
      },
      transport: this.transport,
      protocol: {
        id: this.protocolId,
        name: 'BY Tech OEM protocol (feature report ' + this.reportId + ')',
      },
      battery: null,
      fields: [
        {
          key: 'modelCode',
          label: 'Model code',
          value: identityHex(this.identity),
          confidence: Evidence.VERIFIED,
          source: 'GET_INFO 0x82/1',
        },
        {
          key: 'modelSource',
          label: 'Model table',
          value: this.model ? this.model.source : 'not in OpenKey’s table — please report it',
          confidence: this.model ? Evidence.INFERRED : Evidence.UNKNOWN,
          source: 'BY_TECH_MODELS',
        },
        ...(page
          ? [
              {
                key: 'settingsPage',
                label: 'Settings page',
                value: isValidPage(page) ? 'readable (5A A5 marker present)' : 'unexpected format',
                confidence: Evidence.OBSERVED,
                source: 'GET_LED 0x84',
              },
            ]
          : []),
      ],
      raw: { identity: toHex(this.identity) },
    };
  }

  /** Reads the 128-byte settings page exactly as the keyboard stores it. */
  override async syncClock(date: Date = new Date()): Promise<void> {
    if (!this.model?.screenClock)
      throw new UnsupportedFeatureError('tftClock', 'this model has no screen clock');
    if (this.transport !== 'usb')
      throw new UnsupportedFeatureError('tftClock', 'set the clock over the USB cable');
    await this.s().write(Cmd.SET_SCREEN_PARAM, 0, screenParams(date));
  }

  async readSettingsPage(): Promise<Uint8Array> {
    return this.s().readSettingsPage();
  }

  /**
   * Records a page layout the owner confirmed: the effect byte and a settings slot both changed
   * when they pressed the keyboard's own shortcuts. Takes effect on the next connection.
   */
  async learnLayout(layout: PageLayout): Promise<void> {
    if (this.model?.pageLayout) throw new ProtocolError('This model’s layout is already known.');
    const l: LearnedLayout = { ...layout, confirmedAt: new Date().toISOString() };
    await this.opts.store.set(learnedLayoutKey(this.identity), l);
    this.learned = l;
  }

  async forgetLayout(): Promise<void> {
    await this.opts.store.delete(learnedLayoutKey(this.identity));
    this.learned = null;
  }

  override getRgbEffects(): EffectCatalog {
    if (this.model?.effects) {
      const cat = effectCatalog(this.model);
      return this.matrix ? { ...cat, customEffect: SELF_DEFINE } : cat;
    }
    // Learned layout on an unknown effect list: offer the effect positions without names.
    const n = 20;
    return {
      effects: Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        name: `Effect ${i + 1}`,
        controls: { color: true, colorful: true, brightness: true, speed: true, direction: [] },
      })),
      brightness: { min: 0, max: this.model?.brightnessMax ?? 5 },
      speed: { min: 0, max: 4 },
    };
  }

  private requireLayout(): PageLayout {
    const l = this.layout;
    if (!l)
      throw new ProtocolError(
        'The settings-page layout of this model is not confirmed; nothing is written.',
      );
    return l;
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    const layout = this.requireLayout();
    const page = await this.readSettingsPage();
    assertValidPage(page);
    const effect = page[layout.effect]!;
    const slot = readSlot(page, layout, effect) ?? { brightness: 0, speed: 0, color: 0 };
    const fixed = FIRMWARE_COLORS[slot.color] ?? FIRMWARE_COLORS[6]!;
    return {
      effect,
      color: { r: fixed[1], g: fixed[2], b: fixed[3] },
      colorful: slot.color === COLOR_CYCLE,
      brightness: slot.brightness,
      speed: slot.speed,
      direction: 'right',
    };
  }

  /** Read, patch, write, read back. Throws ReadbackMismatchError when the keyboard did not keep it. */
  private async patch(change: Parameters<typeof patchPage>[2]): Promise<void> {
    const layout = this.requireLayout();
    const before = await this.readSettingsPage();
    const next = patchPage(before, layout, change);
    // RK web driver: when `LedParameterType` (0x05) is not 0, the keyboard uses the global
    // brightness (0x06) and speed (0x07) instead of the effect's own slot; both are kept in step.
    if (change.slot && layout === BY_TECH_LAYOUT && before[0x05] !== 0) {
      if (change.slot.brightness !== undefined) next[0x06] = change.slot.brightness & 0xff;
      if (change.slot.speed !== undefined) next[0x07] = change.slot.speed & 0xff;
    }
    if (diffPages(before, next).length === 0) return;
    await this.s().writeSettingsPage(next);
    const after = await this.readSettingsPage();
    const off = diffPages(next, after);
    if (off.length)
      throw new ReadbackMismatchError(
        `The keyboard did not keep ${off.length} changed byte(s) of the settings page.`,
        {
          offsets: off.map((d) => d.offset),
        },
      );
  }

  override async setRgbConfig(config: RgbConfig): Promise<void> {
    // Off (RK effect 0) has no settings slot: only the effect byte changes.
    if (config.effect === 0 && this.model?.effects === 'rk-web') return this.patch({ effect: 0 });
    const color = config.colorful
      ? COLOR_CYCLE
      : nearestFirmwareColor(config.color.r, config.color.g, config.color.b);
    await this.patch({
      effect: config.effect,
      slot: { effect: config.effect, brightness: config.brightness, speed: config.speed, color },
    });
  }

  override getSettingsSchema(): SettingsSchema {
    return this.model?.effects === 'aula-fw24' ? { sleepTime: [...AULA_SLEEP] } : {};
  }

  override async getSystemSettings(): Promise<SystemSettings> {
    const layout = this.requireLayout();
    if (layout.sleep === null) return {};
    const page = await this.readSettingsPage();
    assertValidPage(page);
    return { sleepTime: page[layout.sleep]! };
  }

  override async setSystemSettings(settings: SystemSettings): Promise<void> {
    if (settings.sleepTime === undefined) return;
    if (!AULA_SLEEP.some((o) => o.value === settings.sleepTime))
      throw new ProtocolError(`sleep value ${settings.sleepTime} is not in the model’s list`);
    await this.patch({ sleep: settings.sleepTime });
  }
}

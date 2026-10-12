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
  toHex,
} from '@openkey/core';
import type {
  Capabilities,
  DeviceInfo,
  EffectCatalog,
  KeyboardLayout,
  RgbConfig,
  SettingsSchema,
  StateStore,
  SystemSettings,
  TransportMode,
} from '@openkey/core';
import { getLayout } from '@openkey/devices';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import { BY_TECH_PROTOCOL_ID } from './constants.js';
import { AULA_SLEEP, effectCatalog, identityHex } from './models.js';
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
import type { PageLayout } from './page.js';
import { ByTechSession } from './session.js';
import type { ByTechSessionOptions } from './session.js';

/** Where a settings-page layout confirmed by the owner's own key presses is kept (per model code). */
export const learnedLayoutKey = (identity: Uint8Array): string =>
  `by-tech/layout/${identityHex(identity).replace(/ /g, '')}`;

export interface LearnedLayout extends PageLayout {
  /** ISO date of the confirmation; the evidence is the owner's key press observed by a read. */
  confirmedAt: string;
}

export interface ByTechDriverOptions extends ByTechSessionOptions {
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

  getLayout(): KeyboardLayout {
    return getLayout(this.model?.layoutId ?? 'ak820-pro');
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
          : 'settings page (leisiji/AulaSofwareLinux, verified on an AULA F75)',
        note: 'Read from the keyboard, patched, written back and read again to confirm.',
      });
      c.sleep = this.model?.effects
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
    c.perKeyRgb = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
      confidence: Evidence.INFERRED,
      note: 'Per-key colours need the model’s LED map; not implemented.',
    });
    c.keymap = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
      confidence: Evidence.INFERRED,
      note: 'Third-party sources disagree on the key encoding.',
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
    if (this.model?.effects) return effectCatalog(this.model);
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
    const color = config.colorful
      ? COLOR_CYCLE
      : nearestFirmwareColor(config.color.r, config.color.g, config.color.b);
    await this.patch({
      effect: config.effect,
      slot: { effect: config.effect, brightness: config.brightness, speed: config.speed, color },
    });
  }

  override getSettingsSchema(): SettingsSchema {
    return this.model?.effects ? { sleepTime: [...AULA_SLEEP] } : {};
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

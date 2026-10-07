import {
  BaseKeyboardDriver,
  Confidence,
  SafetyBlockedError,
  ScopedStateStore,
  TftUploadError,
  UnsupportedFeatureError,
  formatBcd,
  toHex,
} from '@openak820/core';
import type {
  Capabilities,
  DeviceInfo,
  EffectCatalog,
  KeyboardLayout,
  KeymapState,
  LayerId,
  Macro,
  MacroLimits,
  PacketLog,
  PerKeyRgb,
  ProgressCallback,
  RgbConfig,
  Rgb,
  SettingsSchema,
  StateStore,
  SystemSettings,
  TftFrame,
  TftInfo,
  TftStatus,
  TransportMode,
  UploadOptions,
} from '@openak820/core';
import { LoggingTransport, findInterface } from '@openak820/hid';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openak820/hid';
import { getLayout } from '@openak820/profiles';
import type { DriverOptions } from '../../registry.js';
import {
  CONTROL_USAGE_PAGE,
  CUSTOM_EFFECT,
  Cmd,
  DATA_CHUNK_SIZE,
  DATA_USAGE_PAGE,
  MACRO_SLOTS,
  TABLE_PACKETS,
  TFT_DELAY_UNIT_MS,
  REPORT_ID,
} from './constants.js';
import { encodeKeymapTable } from './codecs/keymap.js';
import {
  customModePacket,
  decodePerKeyTable,
  effectCatalog,
  encodeLightingData,
  encodePerKeyTable,
  encodeRealtimeTable,
} from './codecs/lighting.js';
import { MACRO_LIMITS, encodeMacroStorage } from './codecs/macros.js';
import {
  DEFAULT_SETTINGS,
  SETTINGS_ENABLE,
  SETTINGS_SCHEMA,
  SETTINGS_SUB,
  encodeSettingsData,
} from './codecs/settings.js';
import { encodeTimeData } from './codecs/time.js';
import { planTftUpload, tftChunks } from './codecs/tft.js';
import { commandPacketU16 } from './frame.js';
import { SonixFeatureSession } from './session.js';
import type { SonixFeatureVariant } from './variants.js';
import { sonixFeatureCapabilities } from './capabilities.js';

export const SONIX_FEATURE_PROTOCOL_ID = 'sonix-feature';

/** Report ID of the first report of the given kind in the interface's collections (0 if none declared). */
export function descriptorReportId(iface: HidInterfaceInfo, kind: 'featureReports' | 'outputReports'): number {
  for (const c of iface.collections) {
    const r = c[kind][0];
    if (r) return r.reportId;
  }
  return REPORT_ID;
}

const MIRROR = {
  keymap: (layer: LayerId) => `keymap/${layer}`,
  rgb: 'rgb',
  perKey: 'perKeyRgb',
  macros: 'macros',
  settings: 'settings',
  tft: 'tft',
} as const;

export class SonixFeatureDriver extends BaseKeyboardDriver {
  readonly protocolId = SONIX_FEATURE_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: SonixFeatureSession | null = null;
  private transports: HidTransport[] = [];
  private readonly store: StateStore;
  private readonly log: PacketLog;
  private readonly layout: KeyboardLayout;
  private readonly catalog: EffectCatalog;

  constructor(
    private readonly group: HidDeviceGroup,
    readonly variant: SonixFeatureVariant,
    private readonly opts: DriverOptions,
  ) {
    super();
    this.transport = group.transportHint;
    const id = group.identity;
    this.store = new ScopedStateStore(
      opts.store,
      `${SONIX_FEATURE_PROTOCOL_ID}:${id.vendorId}:${id.productId}:${id.productName}:${id.serialNumber ?? ''}`,
    );
    this.log = opts.log;
    this.layout = getLayout(variant.profile.layout);
    const rgb = variant.profile.rgb;
    this.catalog = effectCatalog(rgb?.brightnessMax ?? 5, rgb?.speedMax ?? 5);
  }

  async connect(): Promise<void> {
    if (this.session) return;
    if (this.transport === 'bluetooth') {
      throw new UnsupportedFeatureError(
        'configuration',
        'the firmware does not accept configuration over Bluetooth; connect by USB cable',
      );
    }
    const ctrlIface = findInterface(this.group, (c) => c.usagePage === CONTROL_USAGE_PAGE);
    if (!ctrlIface)
      throw new UnsupportedFeatureError('configuration', 'control interface (FF13) not present');
    const dataIface = findInterface(this.group, (c) => c.usagePage === DATA_USAGE_PAGE);
    const control = new LoggingTransport(await this.group.openInterface(ctrlIface), this.log);
    this.transports.push(control);
    let data: HidTransport | null = null;
    if (dataIface) {
      data = new LoggingTransport(await this.group.openInterface(dataIface), this.log);
      this.transports.push(data);
    }
    this.session = new SonixFeatureSession(control, data, {
      featureReportId: descriptorReportId(ctrlIface, 'featureReports'),
      dataReportId: dataIface ? descriptorReportId(dataIface, 'outputReports') : REPORT_ID,
      ...(this.opts.cmdDelayMs !== undefined ? { cmdDelayMs: this.opts.cmdDelayMs } : {}),
      ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
    });
  }

  async disconnect(): Promise<void> {
    const ts = this.transports.splice(0);
    this.session = null;
    for (const t of ts) await t.close().catch(() => undefined);
  }

  private s(): SonixFeatureSession {
    if (!this.session) throw new SafetyBlockedError('Not connected');
    return this.session;
  }

  private requireKnownVariant(what: string): void {
    if (!this.variant.known && !this.opts.allowExperimental) {
      throw new SafetyBlockedError(
        `${what} is disabled for unrecognised product "${this.group.identity.productName}". The protocol matches, but key positions and limits are not verified for this model. Enable experimental mode to proceed.`,
      );
    }
  }

  getLayout(): KeyboardLayout {
    return this.layout;
  }

  getCapabilities(): Capabilities {
    return sonixFeatureCapabilities(this.variant, this.transport);
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const id = this.group.identity;
    const p = this.variant.profile;
    const fw = id.release !== undefined ? formatBcd(id.release) : null;
    return {
      model: this.variant.known
        ? p.model
        : `Unrecognised AK820-family keyboard "${id.productName}"`,
      profileId: p.id,
      identity: id,
      firmware: {
        version: fw,
        source: fw ? 'USB bcdDevice' : 'not exposed by this platform (WebHID hides bcdDevice)',
        confidence: fw ? Confidence.INFERRED : Confidence.UNVERIFIED,
      },
      transport: this.transport,
      protocol: {
        id: this.protocolId,
        name: 'AJAZZ Windows-driver feature-report protocol',
        revision: 'DeviceDriver 1.0.0.5 command set',
      },
      battery: null,
      fields: [
        {
          key: 'productString',
          label: 'USB product string',
          value: id.productName,
          confidence: Confidence.CONFIRMED,
          source: 'USB descriptor',
        },
        {
          key: 'manufacturer',
          label: 'Manufacturer',
          value: id.manufacturer ?? null,
          confidence: Confidence.CONFIRMED,
          source: 'USB descriptor',
        },
        {
          key: 'tft',
          label: 'TFT',
          value: p.tft
            ? `${p.tft.width}×${p.tft.height} RGB565, ≤${p.tft.maxFrames} frames`
            : 'none',
          confidence: Confidence.STRONGLY_SUPPORTED,
          source: 'official driver layout <screen>',
        },
        {
          key: 'layout',
          label: 'Layout',
          value: this.layout.name,
          confidence: Confidence.STRONGLY_SUPPORTED,
          source: 'official driver key table',
        },
        {
          key: 'macroSlots',
          label: 'Macro slots',
          value: MACRO_SLOTS,
          confidence: Confidence.STRONGLY_SUPPORTED,
          source: 'FUN_0042d6f0',
        },
        {
          key: 'battery',
          label: 'Battery',
          value: 'not readable over this protocol',
          confidence: Confidence.INFERRED,
          source: 'no battery query in official wired driver',
        },
      ],
    };
  }

  // ---------------------------------------------------------------- keymap

  override async getKeymap(layer: LayerId = 'base'): Promise<KeymapState> {
    const m = await this.store.get<KeymapState>(MIRROR.keymap(layer));
    return m ?? { layer, slots: {}, provenance: 'assumed-default' };
  }

  override async setKeymap(state: KeymapState): Promise<void> {
    this.requireKnownVariant('Keymap writing');
    const table = encodeKeymapTable(state);
    const cmd = state.layer === 'fn' ? Cmd.KEYMAP_FN : Cmd.KEYMAP_BASE;
    const s = this.s();
    await s.transaction(async () => {
      await s.command(Cmd.START);
      await s.command(cmd, { arg8: TABLE_PACKETS });
      await s.sendTable(table);
      await s.command(Cmd.SAVE);
      await s.command(Cmd.FINISH);
    });
    await this.store.set(MIRROR.keymap(state.layer), {
      ...state,
      provenance: 'mirror',
      updatedAt: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------- lighting

  override getRgbEffects(): EffectCatalog {
    return this.catalog;
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    const m = await this.store.get<RgbConfig>(MIRROR.rgb);
    if (m) return m;
    const d = this.variant.profile.rgb;
    return {
      effect: d?.defaultEffect ?? 1,
      color: { r: 255, g: 255, b: 255 },
      colorful: false,
      brightness: d?.brightnessMax ?? 5,
      speed: 3,
      direction: 'left',
    };
  }

  override async setRgbConfig(config: RgbConfig): Promise<void> {
    const data = encodeLightingData(config, this.catalog);
    const s = this.s();
    await s.transaction(async () => {
      await s.command(Cmd.START);
      await s.command(Cmd.LIGHT_MODE, { arg8: 1 });
      await s.sendPacket(data, false);
      await s.command(Cmd.SAVE);
      await s.command(Cmd.FINISH, {}, { handshake: false });
    });
    await this.store.set(MIRROR.rgb, config);
  }

  override async getPerKeyRgb(): Promise<PerKeyRgb> {
    const s = this.s();
    const table = await s.transaction(async () => {
      const t = await s.readTable(Cmd.READ_PER_KEY_RGB, TABLE_PACKETS);
      // FUN_0042aee0 follows the read with SAVE; reproduced exactly.
      await s.command(Cmd.SAVE);
      return t;
    });
    const indices = this.layout.keys.map((k) => k.light).filter((n): n is number => n !== null);
    return decodePerKeyTable(table, indices);
  }

  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    const table = encodePerKeyTable(colors);
    const s = this.s();
    await s.transaction(async () => {
      // FUN_0044b900: switch the effect to the per-key table (0x80) first.
      await s.command(Cmd.START);
      await s.command(Cmd.LIGHT_MODE, { arg8: 1 });
      await s.sendPacket(customModePacket(CUSTOM_EFFECT), false);
      await s.command(Cmd.SAVE);
      await s.command(Cmd.FINISH, {}, { handshake: false });
      // FUN_0044ba10: per-key table.
      await s.command(Cmd.START);
      await s.command(Cmd.PER_KEY_RGB, { arg8: TABLE_PACKETS });
      await s.sendTable(table);
      await s.command(Cmd.SAVE);
      await s.command(Cmd.FINISH);
    });
    await this.store.set(MIRROR.perKey, colors);
    const prev = await this.getRgbConfig();
    await this.store.set(MIRROR.rgb, { ...prev, effect: CUSTOM_EFFECT });
  }

  /** Live colours without persisting (FUN_004329e0). */
  async streamRealtime(colors: [number, Rgb][]): Promise<void> {
    const s = this.s();
    await s.transaction(async () => {
      await s.command(Cmd.REALTIME_RGB, { arg8: 8 }, { requireAck: false });
      await s.sendTable(encodeRealtimeTable(colors));
      await s.command(Cmd.SAVE, {}, { requireAck: false });
    });
  }

  // ---------------------------------------------------------------- macros

  override getMacroLimits(): MacroLimits {
    return MACRO_LIMITS;
  }

  override async getMacros(): Promise<Macro[]> {
    return (await this.store.get<Macro[]>(MIRROR.macros)) ?? [];
  }

  override async setMacros(macros: Macro[]): Promise<void> {
    const { image, packets } = encodeMacroStorage(macros);
    const s = this.s();
    await s.transaction(async () => {
      await s.command(Cmd.MACRO_BEGIN);
      await s.command(Cmd.MACRO_DATA, { arg8: packets });
      await s.delay(30);
      await s.sendTable(image);
      await s.delay(30);
      await s.command(Cmd.SAVE);
    });
    await this.store.set(MIRROR.macros, macros);
  }

  // ---------------------------------------------------------------- TFT

  override async getTftInfo(): Promise<TftInfo> {
    const t = this.variant.profile.tft;
    if (!t || this.transport !== 'usb')
      throw new UnsupportedFeatureError(
        'tft',
        t ? 'the screen can only be updated over USB' : 'this model has no screen',
      );
    return {
      width: t.width,
      height: t.height,
      pixelFormat: 'rgb565le',
      maxFrames: t.maxFrames ?? 1,
      slots: t.slots,
      delayUnitMs: TFT_DELAY_UNIT_MS,
      minDelayMs: TFT_DELAY_UNIT_MS,
      maxDelayMs: 255 * TFT_DELAY_UNIT_MS,
      chunkBytes: DATA_CHUNK_SIZE,
    };
  }

  override async uploadTftImage(frame: TftFrame, onProgress?: ProgressCallback, opts?: UploadOptions): Promise<void> {
    return this.uploadTftGif([{ ...frame, delayMs: frame.delayMs || 0 }], onProgress, opts);
  }

  override async uploadTftGif(frames: TftFrame[], onProgress?: ProgressCallback, opts: UploadOptions = {}): Promise<void> {
    const slot = opts.slot ?? 1;
    const info = await this.getTftInfo();
    if (slot < 1 || slot > info.slots) throw new TftUploadError(`Slot ${slot} outside 1..${info.slots}`);
    const plan = planTftUpload(frames, info.width, info.height, info.maxFrames);
    const s = this.s();
    const aborted = () => {
      if (opts.signal?.aborted) throw new TftUploadError('Upload cancelled; nothing was committed, the previous animation stays.');
    };
    aborted();
    onProgress?.({ phase: 'prepare', sent: 0, total: plan.chunks });
    await s.transaction(async () => {
      await s.command(Cmd.START);
      const { ack, response } = await s.sendPacket(commandPacketU16(Cmd.IMAGE, slot, plan.chunks), true);
      if (ack && !ack.ok) throw new TftUploadError('Keyboard rejected the image header', { response: response ? toHex(response) : '' });
      let i = 0;
      for (const chunk of tftChunks(frames, plan)) {
        aborted();
        await s.sendDataChunk(chunk);
        onProgress?.({ phase: 'transfer', sent: ++i, total: plan.chunks });
      }
      onProgress?.({ phase: 'commit', sent: plan.chunks, total: plan.chunks });
      await s.command(Cmd.SAVE);
    });
    await this.store.set(MIRROR.tft, { frames: plan.frames, at: new Date().toISOString() });
    onProgress?.({ phase: 'done', sent: plan.chunks, total: plan.chunks });
  }

  override async getTftStatus(): Promise<TftStatus> {
    const last = await this.store.get<{ frames: number; at: string }>(MIRROR.tft);
    return { activeSlot: last ? 1 : null, ...(last ? { lastUpload: last } : {}) };
  }

  override async syncClock(date: Date = new Date()): Promise<void> {
    const s = this.s();
    await s.transaction(async () => {
      await s.command(Cmd.START);
      await s.command(Cmd.TIME, { arg8: 1 });
      await s.sendPacket(encodeTimeData(date, 1), true);
      await s.command(Cmd.SAVE);
    });
  }

  // ---------------------------------------------------------------- settings

  override getSettingsSchema(): SettingsSchema {
    return SETTINGS_SCHEMA;
  }

  override async getSystemSettings(): Promise<SystemSettings> {
    return (await this.store.get<SystemSettings>(MIRROR.settings)) ?? { ...DEFAULT_SETTINGS };
  }

  override async setSystemSettings(settings: SystemSettings): Promise<void> {
    const merged = { ...(await this.getSystemSettings()), ...settings };
    const data = encodeSettingsData(merged);
    const s = this.s();
    await s.transaction(async () => {
      await s.command(Cmd.START);
      await s.command(Cmd.SETTINGS, { sub: SETTINGS_SUB, arg8: SETTINGS_ENABLE });
      await s.sendPacket(data, false);
      await s.command(Cmd.SAVE);
    });
    await this.store.set(MIRROR.settings, merged);
  }

  override async restoreDefaults(
    scope: 'keymap' | 'fnLayer' | 'macros' | 'lighting',
  ): Promise<void> {
    switch (scope) {
      case 'keymap':
        return this.setKeymap({ layer: 'base', slots: {}, provenance: 'mirror' });
      case 'fnLayer':
        return this.setKeymap({ layer: 'fn', slots: {}, provenance: 'mirror' });
      case 'macros':
        return this.setMacros([]);
      case 'lighting': {
        const d = this.variant.profile.rgb;
        return this.setRgbConfig({
          effect: d?.defaultEffect ?? 1,
          color: { r: 255, g: 255, b: 255 },
          colorful: true,
          brightness: d?.brightnessMax ?? 5,
          speed: 3,
          direction: 'left',
        });
      }
    }
  }
}

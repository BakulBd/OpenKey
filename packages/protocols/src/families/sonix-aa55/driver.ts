import { FeatureStatus, configurable, feature } from '@openkey/core';
import {
  BaseKeyboardDriver,
  Evidence,
  ScopedStateStore,
  TftUploadError,
  UnsupportedFeatureError,
  emptyCapabilities,
  hex16,
} from '@openkey/core';
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
  SettingsSchema,
  StateStore,
  SystemSettings,
  TftFrame,
  TftInfo,
  TftStatus,
  TransportMode,
  UploadOptions,
} from '@openkey/core';
import { LoggingTransport, findInterface, maxReportSize } from '@openkey/hid';
import type { HidDeviceGroup, HidTransport } from '@openkey/hid';
import { getLayout, getProfile } from '@openkey/devices';
import type { DriverOptions } from '../../registry.js';
import { decodePerKeyEntries, encodePerKeyEntries } from '../common/per-key.js';
import { SONIX_FEATURE_EFFECTS } from '../sonix-feature/codecs/lighting.js';
import {
  CUSTOM_LED_BYTES,
  Cmd,
  DEFAULT_MACRO_SPACE,
  DEVICE_INFO_BYTES,
  GAME_MODE_BYTES,
  KEY_TABLE_BYTES,
  LED_EFFECT_BYTES,
  MACRO_INDEX_BYTES,
  MACRO_SLOTS,
  TFT_DEFAULT_REPORT_BYTES,
  TFT_USAGE_PAGE,
} from './constants.js';
import {
  buildAa55TftPayload,
  decodeDeviceInfo,
  decodeGameMode,
  decodeKeyTable,
  decodeLedEffect,
  decodeMacroBlock,
  encodeGameMode,
  encodeKeyTable,
  encodeLedEffect,
  encodeMacrosAa55,
  tftChunkHeader,
} from './codecs.js';
import type { Aa55DeviceInfo, Aa55GameMode } from './codecs.js';
import { Aa55Link } from './transfer.js';
import { configInterface } from './match.js';

export const SONIX_AA55_PROTOCOL_ID = 'sonix-aa55';

export class SonixAa55Driver extends BaseKeyboardDriver {
  readonly protocolId = SONIX_AA55_PROTOCOL_ID;
  readonly transport: TransportMode;
  private link: Aa55Link | null = null;
  private tftLink: Aa55Link | null = null;
  private transports: HidTransport[] = [];
  private info: Aa55DeviceInfo | null = null;
  private readonly store: StateStore;
  private readonly log: PacketLog;
  private readonly profile = getProfile('ak820-pro-online')!;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly opts: DriverOptions,
  ) {
    super();
    this.transport = group.transportHint;
    this.store = new ScopedStateStore(opts.store, `${SONIX_AA55_PROTOCOL_ID}:${group.key}`);
    this.log = opts.log;
  }

  async connect(): Promise<void> {
    if (this.link) return;
    const iface = configInterface(this.group);
    if (!iface)
      throw new UnsupportedFeatureError(
        'configuration',
        'no online-driver configuration collection',
      );
    const t = new LoggingTransport(await this.group.openInterface(iface), this.log);
    this.transports.push(t);
    this.link = new Aa55Link(t, this.opts.sleep ? { sleep: this.opts.sleep } : {});
    this.info = decodeDeviceInfo(await this.link.read(Cmd.GET_DEVICE_INFO, DEVICE_INFO_BYTES));
    const tftIface = findInterface(this.group, (c) => c.usagePage === TFT_USAGE_PAGE);
    if (tftIface) {
      const tt = new LoggingTransport(await this.group.openInterface(tftIface), this.log);
      this.transports.push(tt);
      this.tftLink = new Aa55Link(tt, {
        ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
        packetSize:
          maxReportSize(tftIface.collections[0]?.outputReports ?? []) || TFT_DEFAULT_REPORT_BYTES,
      });
    }
  }

  async disconnect(): Promise<void> {
    this.link = null;
    this.tftLink = null;
    for (const t of this.transports.splice(0)) await t.close().catch(() => undefined);
  }

  private l(): Aa55Link {
    if (!this.link) throw new UnsupportedFeatureError('configuration', 'not connected');
    return this.link;
  }

  getLayout(): KeyboardLayout {
    return getLayout(this.profile.layout);
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const S = Evidence.OBSERVED;
    c.deviceInfo = feature(FeatureStatus.SUPPORTED_READ_ONLY, { read: 'device', confidence: S, source: 'GET_DEVICE_INFO (_n)' });
    c.keymap = configurable('device', true, S);
    c.fnLayer = configurable('device', true, S);
    c.macros = configurable('device', true, S);
    c.rgb = configurable('device', true, S);
    c.perKeyRgb = configurable('device', true, S);
    c.battery = feature(FeatureStatus.SUPPORTED_READ_ONLY, { read: 'device', confidence: S, source: 'GET_DEVICE_INFO byte 17' });
    c.sleep = configurable('device', true, S);
    c.gameMode = configurable('device', true, S, { source: 'game-mode struct byte 1' });
    c.pollingRate = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
      read: 'device',
      confidence: Evidence.INFERRED,
      note: 'reportRate byte is read; its value mapping is not known yet.',
    });
    c.knob = feature(FeatureStatus.PHYSICALLY_PRESENT_NOT_PROGRAMMABLE, {
      confidence: S,
      value: 'Volume up / down, mute',
      note: 'wheelKeys is empty for the AK820 Pro in the online driver.',
    });
    if (this.tftLink) {
      c.tft = configurable('none', true, Evidence.INFERRED, { note: 'Chunk format from the online driver; not hardware-verified by OpenKey (experimental).' });
      c.tftGif = { ...c.tft };
      c.tftClock = configurable('none', true, Evidence.INFERRED);
      c.tftBuiltIn = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, { confidence: Evidence.INFERRED, note: 'SET_TFT_BUILT_IN_INDEX exists; built-in count unknown.' });
    }
    c.factoryDefaults = configurable('none', true, S, { note: 'Writes the firmware default matrix read from the keyboard. The factory-reset command is blocked by policy.' });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const i =
      this.info ?? decodeDeviceInfo(await this.l().read(Cmd.GET_DEVICE_INFO, DEVICE_INFO_BYTES));
    const S = Evidence.OBSERVED;
    return {
      model: this.profile.model,
      profileId: this.profile.id,
      identity: this.group.identity,
      firmware: { version: i.version, source: 'GET_DEVICE_INFO', confidence: S },
      transport: this.transport,
      protocol: {
        id: this.protocolId,
        name: 'AJAZZ online-driver protocol (AA/55 output reports)',
        revision: `frameVersion ${i.frameVersion}`,
      },
      battery: { level: i.batteryLevel, charging: i.chargeStatus === 1 },
      fields: [
        {
          key: 'vidpid',
          label: 'VID/PID reported by firmware',
          value: `${hex16(i.vid)}:${hex16(i.pid)}`,
          confidence: S,
          source: 'GET_DEVICE_INFO',
        },
        {
          key: 'macroSpace',
          label: 'Macro space',
          value: i.macroSpaceSize,
          confidence: S,
          source: 'GET_DEVICE_INFO',
        },
        {
          key: 'profile',
          label: 'Current profile',
          value: i.currentProfile,
          confidence: S,
          source: 'GET_DEVICE_INFO',
        },
        {
          key: 'tftMaxFrames',
          label: 'TFT max frames',
          value: i.tftMaxFrames,
          confidence: S,
          source: 'GET_DEVICE_INFO',
        },
        {
          key: 'workMode',
          label: 'Work mode',
          value: i.workMode,
          confidence: Evidence.INFERRED,
          source: 'GET_DEVICE_INFO',
        },
      ],
    };
  }

  override async getBattery() {
    const i = decodeDeviceInfo(await this.l().read(Cmd.GET_DEVICE_INFO, DEVICE_INFO_BYTES));
    return { level: i.batteryLevel, charging: i.chargeStatus === 1 };
  }

  override async getKeymap(layer: LayerId = 'base'): Promise<KeymapState> {
    return decodeKeyTable(
      await this.l().read(layer === 'fn' ? Cmd.GET_FN_KEY : Cmd.GET_KEY, KEY_TABLE_BYTES, {
        timeoutMs: 500,
      }),
      layer,
    );
  }

  override async setKeymap(state: KeymapState): Promise<void> {
    await this.l().transfer({
      cmd: state.layer === 'fn' ? Cmd.SET_FN_KEY : Cmd.SET_KEY,
      contentSize: KEY_TABLE_BYTES,
      data: encodeKeyTable(state),
      timeoutMs: 1000,
    });
  }

  override async restoreDefaults(
    scope: 'keymap' | 'fnLayer' | 'macros' | 'lighting',
  ): Promise<void> {
    if (scope === 'keymap' || scope === 'fnLayer') {
      // The online driver's "Factory default" button reads the firmware default matrix and stages it.
      const cmd = scope === 'keymap' ? Cmd.GET_DEFAULT_KEY_MATRIX : Cmd.GET_DEFAULT_FN_KEY_MATRIX;
      const def = decodeKeyTable(
        await this.l().read(cmd, KEY_TABLE_BYTES),
        scope === 'keymap' ? 'base' : 'fn',
      );
      return this.setKeymap(def);
    }
    if (scope === 'macros') return this.setMacros([]);
    return super.restoreDefaults(scope);
  }

  override getRgbEffects(): EffectCatalog {
    return {
      effects: SONIX_FEATURE_EFFECTS,
      brightness: { min: 0, max: 5 },
      speed: { min: 0, max: 5 },
      offEffect: 0,
      customEffect: 0x80,
    };
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    return decodeLedEffect(await this.l().read(Cmd.GET_LED_EFFECT, LED_EFFECT_BYTES));
  }

  override async setRgbConfig(config: RgbConfig): Promise<void> {
    await this.l().transfer({
      cmd: Cmd.SET_LED_EFFECT,
      contentSize: LED_EFFECT_BYTES,
      data: encodeLedEffect(config),
    });
  }

  override async getPerKeyRgb(): Promise<PerKeyRgb> {
    const t = await this.l().read(Cmd.GET_CUSTOM_LED_DATA, CUSTOM_LED_BYTES);
    return decodePerKeyEntries(
      t,
      this.getLayout()
        .keys.map((k) => k.light)
        .filter((n): n is number => n !== null && n < 128),
    );
  }

  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    await this.l().transfer({
      cmd: Cmd.SET_CUSTOM_LED_DATA,
      contentSize: CUSTOM_LED_BYTES,
      data: encodePerKeyEntries(colors, 128, true),
      timeoutMs: 2000,
    });
  }

  override getMacroLimits(): MacroLimits {
    return {
      slots: MACRO_SLOTS,
      storageBytes: this.info?.macroSpaceSize || DEFAULT_MACRO_SPACE,
      minDelayMs: 0,
      maxDelayMs: 0xffff,
    };
  }

  override async getMacros(): Promise<Macro[]> {
    const l = this.l();
    const index = await l.read(Cmd.GET_MACRO, MACRO_INDEX_BYTES, { addrStart: 0 });
    const view = new DataView(index.buffer, index.byteOffset, index.byteLength);
    const out: Macro[] = [];
    for (let i = 0; i < MACRO_SLOTS; i++) {
      const addr = view.getUint32(i * 4, true);
      if (!addr) continue;
      const head = await l.read(Cmd.GET_MACRO, 4, { addrStart: addr });
      const count = Math.floor((head[0]! | (head[1]! << 8)) / 2);
      const actions =
        count > 0
          ? await l.read(Cmd.GET_MACRO, count * 4, { addrStart: addr + 4 })
          : new Uint8Array();
      out.push({ index: i, events: decodeMacroBlock(actions, count) });
    }
    await this.store.set('macros', out);
    return out;
  }

  override async setMacros(macros: Macro[]): Promise<void> {
    const { index, data } = encodeMacrosAa55(macros);
    if (index.length + data.length > this.getMacroLimits().storageBytes)
      throw new UnsupportedFeatureError('macros', 'macros exceed the device macro space');
    const l = this.l();
    await l.transfer({
      cmd: Cmd.SET_MACRO,
      contentSize: MACRO_INDEX_BYTES,
      isNeedLastPacketFlag: false,
      addrStart: 0,
      data: index,
    });
    if (data.length)
      await l.transfer({
        cmd: Cmd.SET_MACRO,
        contentSize: data.length,
        isNeedLastPacketFlag: true,
        addrStart: MACRO_INDEX_BYTES,
        data,
      });
  }

  override getSettingsSchema(): SettingsSchema {
    return {};
  }

  private async gameMode(): Promise<Aa55GameMode> {
    return decodeGameMode(await this.l().read(Cmd.GET_GAME_MODE, GAME_MODE_BYTES));
  }

  override async getSystemSettings(): Promise<SystemSettings> {
    const g = await this.gameMode();
    return {
      sleepTime: g.sleepTime,
      fnSwitch: g.fnSwitch,
      gameMode: g.gameMode === 1,
      extra: { keyDelay: g.keyDelay, reportRate: g.reportRate, tftDisplayTime: g.tftDisplayTime },
    };
  }

  override async setSystemSettings(s: SystemSettings): Promise<void> {
    const g = await this.gameMode();
    const next: Aa55GameMode = {
      ...g,
      ...(s.sleepTime !== undefined ? { sleepTime: s.sleepTime } : {}),
      ...(s.gameMode !== undefined ? { gameMode: s.gameMode ? 1 : 0 } : {}),
    };
    await this.l().transfer({
      cmd: Cmd.SET_GAME_MODE,
      contentSize: GAME_MODE_BYTES,
      data: encodeGameMode(next),
    });
  }

  override async getGameMode(): Promise<boolean> {
    return (await this.gameMode()).gameMode === 1;
  }

  override async setGameMode(enabled: boolean): Promise<void> {
    await this.setSystemSettings({ gameMode: enabled });
  }

  override async getTftInfo(): Promise<TftInfo> {
    if (!this.tftLink) throw new UnsupportedFeatureError('tft', 'no FF67 TFT pipe on this device');
    return {
      width: 128,
      height: 128,
      pixelFormat: 'rgb565le',
      maxFrames: this.info?.tftMaxFrames || 1,
      slots: 1,
      delayUnitMs: 2,
      minDelayMs: 2,
      maxDelayMs: 510,
      chunkBytes: this.tftLink.packetSize - 8,
    };
  }

  override async uploadTftImage(frame: TftFrame, onProgress?: ProgressCallback, opts?: UploadOptions): Promise<void> {
    return this.uploadTftGif([frame], onProgress, opts);
  }

  override async uploadTftGif(frames: TftFrame[], onProgress?: ProgressCallback, opts: UploadOptions = {}): Promise<void> {
    if (!this.opts.allowExperimental) {
      throw new UnsupportedFeatureError(
        'tft',
        'the online-protocol TFT upload is not hardware-verified; enable experimental mode to try it',
      );
    }
    const info = await this.getTftInfo();
    const used = frames.slice(0, info.maxFrames);
    if (!used.length) throw new TftUploadError('No frames');
    const pixels = new Uint8Array(used.length * info.width * info.height * 2);
    used.forEach((f, i) => pixels.set(f.pixels, i * info.width * info.height * 2));
    const payload = buildAa55TftPayload(
      used.map((f) => f.delayMs),
      pixels,
    );
    const per = info.chunkBytes;
    const total = Math.ceil(payload.length / per);
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new TftUploadError('Upload cancelled');
      await this.tftLink!.transfer({
        cmd: Cmd.SET_TFT_USER_ANIMATION,
        contentSize: per,
        data: payload.subarray(i * per, (i + 1) * per),
        headerCount: 8,
        customHeader: tftChunkHeader(i, total),
        timeoutMs: 2000,
        responseCmd: Cmd.SET_LED_USER_ANIMATION,
      });
      onProgress?.({ phase: 'transfer', sent: i + 1, total });
    }
    await this.store.set('tft', { frames: used.length, at: new Date().toISOString() });
    onProgress?.({ phase: 'done', sent: total, total });
  }

  override async getTftStatus(): Promise<TftStatus> {
    const last = await this.store.get<{ frames: number; at: string }>('tft');
    return { activeSlot: null, ...(last ? { lastUpload: last } : {}) };
  }

  override async syncClock(date = new Date()): Promise<void> {
    // setTftDateTime (`rk`): SET_TEMPORARY_COMMAND_DATA, [5A 01 5A yy mm dd hh mm ss weekday].
    const d = Uint8Array.of(
      0x5a,
      1,
      0x5a,
      date.getFullYear() % 100,
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      date.getDay(),
    );
    await this.l().transfer({ cmd: Cmd.SET_TEMPORARY_COMMAND_DATA, data: d });
  }
}

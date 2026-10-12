import { UnsupportedFeatureError } from './errors.js';
import type { Capabilities, FeatureId } from './model/capabilities.js';
import type { DeviceInfo, TransportMode } from './model/device.js';
import type { KeyActionKind, KeymapState, LayerId } from './model/keymap.js';
import type { KeyboardLayout } from './model/layout.js';
import type { EffectCatalog, PerKeyRgb, RgbConfig } from './model/lighting.js';
import type { Macro, MacroLimits } from './model/macros.js';
import type { SettingsSchema, SystemSettings } from './model/settings.js';
import type { ProgressCallback, TftFrame, TftInfo } from './model/tft.js';

export interface EncoderConfig {
  clockwise: unknown;
  counterClockwise: unknown;
  press: unknown;
}

export interface UploadOptions {
  /** Cancels between chunks; the keyboard keeps its previous content when no commit was sent. */
  signal?: AbortSignal;
  /** Screen slot (1-based) for firmwares with several user slots. */
  slot?: number;
}

export interface TftStatus {
  activeSlot: number | null;
  lastUpload?: { frames: number; at: string };
}

/**
 * Common API implemented by every protocol adapter. Not every keyboard implements everything;
 * unavailable features throw UnsupportedFeatureError and are reported by getCapabilities().
 */
export interface KeyboardDriver {
  readonly protocolId: string;
  readonly transport: TransportMode;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  getDeviceInfo(): Promise<DeviceInfo>;
  getCapabilities(): Capabilities;
  getLayout(): KeyboardLayout;

  /**
   * Key action kinds this adapter can encode. The keymap editor offers only these; anything else
   * would fail at write time. `raw` is never offered: it only preserves encodings read from the device.
   */
  getKeyActionKinds(): readonly KeyActionKind[];
  /** Layers the editor offers, in order. Two-layer boards return `base` and `fn`. */
  getLayerIds(): readonly LayerId[];
  /**
   * Firmware-specific functions offered for assignment as `special` actions (e.g. QMK "Transparent",
   * lighting keys). Never includes functions that reboot or erase the keyboard.
   */
  getSpecialActions(): readonly { code: number; label: string }[];
  getKeymap(layer?: LayerId): Promise<KeymapState>;
  setKeymap(state: KeymapState): Promise<void>;
  getFnLayer(): Promise<KeymapState>;
  setFnLayer(state: KeymapState): Promise<void>;
  /** All non-base layers the firmware exposes (the AK820 family has one Fn layer). */
  getFnLayers(): Promise<KeymapState[]>;
  setFnLayers(layers: KeymapState[]): Promise<void>;

  getMacroLimits(): MacroLimits;
  getMacros(): Promise<Macro[]>;
  setMacros(macros: Macro[]): Promise<void>;

  getRgbEffects(): EffectCatalog;
  getRgbConfig(): Promise<RgbConfig>;
  setRgbConfig(config: RgbConfig): Promise<void>;
  getPerKeyRgb(): Promise<PerKeyRgb>;
  setPerKeyRgb(colors: PerKeyRgb): Promise<void>;

  getTftInfo(): Promise<TftInfo>;
  uploadTftImage(
    frame: TftFrame,
    onProgress?: ProgressCallback,
    opts?: UploadOptions,
  ): Promise<void>;
  uploadTftGif(
    frames: TftFrame[],
    onProgress?: ProgressCallback,
    opts?: UploadOptions,
  ): Promise<void>;
  setTftMode(mode: string): Promise<void>;
  getTftStatus(): Promise<TftStatus>;
  syncClock(date?: Date): Promise<void>;

  getBattery(): Promise<{ level: number; charging: boolean } | null>;
  getPollingRate(): Promise<number>;
  setPollingRate(hz: number): Promise<void>;

  getSettingsSchema(): SettingsSchema;
  getSystemSettings(): Promise<SystemSettings>;
  setSystemSettings(settings: SystemSettings): Promise<void>;
  getSleepConfig(): Promise<{ sleepTime: number }>;
  setSleepConfig(cfg: { sleepTime: number }): Promise<void>;
  getGameMode(): Promise<boolean>;
  setGameMode(enabled: boolean): Promise<void>;
  getKeyResponse(): Promise<number>;
  setKeyResponse(level: number): Promise<void>;
  getWinLock(): Promise<boolean>;
  setWinLock(locked: boolean): Promise<void>;

  getEncoder(): Promise<EncoderConfig>;
  setEncoder(cfg: EncoderConfig): Promise<void>;

  /** Writes the firmware defaults for keymaps/macros/lighting where the protocol has a verified way. */
  restoreDefaults(scope: 'keymap' | 'fnLayer' | 'macros' | 'lighting'): Promise<void>;
}

function unsupported(
  feature: FeatureId | string,
  reason = 'this keyboard/protocol does not provide it',
): never {
  throw new UnsupportedFeatureError(feature, reason);
}

/**
 * Base class: every method throws UnsupportedFeatureError. Adapters override what they support,
 * so a missing implementation can never silently succeed.
 */
export abstract class BaseKeyboardDriver implements KeyboardDriver {
  abstract readonly protocolId: string;
  abstract readonly transport: TransportMode;
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract getDeviceInfo(): Promise<DeviceInfo>;
  abstract getCapabilities(): Capabilities;
  abstract getLayout(): KeyboardLayout;

  getKeyActionKinds(): readonly KeyActionKind[] {
    // Conservative default: an adapter must declare anything beyond plain keys.
    return ['default', 'keyboard'];
  }
  getLayerIds(): readonly LayerId[] {
    const c = this.getCapabilities();
    return c.fnLayer.write || c.fnLayer.read !== 'none' ? ['base', 'fn'] : ['base'];
  }
  getSpecialActions(): readonly { code: number; label: string }[] {
    return [];
  }
  async getKeymap(_layer?: LayerId): Promise<KeymapState> {
    return unsupported('keymap');
  }
  async setKeymap(_state: KeymapState): Promise<void> {
    unsupported('keymap');
  }
  async getFnLayer(): Promise<KeymapState> {
    return this.getKeymap('fn');
  }
  async setFnLayer(state: KeymapState): Promise<void> {
    return this.setKeymap({ ...state, layer: 'fn' });
  }
  async getFnLayers(): Promise<KeymapState[]> {
    return [await this.getKeymap('fn')];
  }
  async setFnLayers(layers: KeymapState[]): Promise<void> {
    for (const l of layers) await this.setKeymap({ ...l, layer: 'fn' });
  }
  getMacroLimits(): MacroLimits {
    return unsupported('macros');
  }
  async getMacros(): Promise<Macro[]> {
    return unsupported('macros');
  }
  async setMacros(_macros: Macro[]): Promise<void> {
    unsupported('macros');
  }
  getRgbEffects(): EffectCatalog {
    return unsupported('rgb');
  }
  async getRgbConfig(): Promise<RgbConfig> {
    return unsupported('rgb');
  }
  async setRgbConfig(_config: RgbConfig): Promise<void> {
    unsupported('rgb');
  }
  async getPerKeyRgb(): Promise<PerKeyRgb> {
    return unsupported('perKeyRgb');
  }
  async setPerKeyRgb(_colors: PerKeyRgb): Promise<void> {
    unsupported('perKeyRgb');
  }
  async getTftInfo(): Promise<TftInfo> {
    return unsupported('tft');
  }
  async uploadTftImage(
    _frame: TftFrame,
    _onProgress?: ProgressCallback,
    _opts?: UploadOptions,
  ): Promise<void> {
    unsupported('tft');
  }
  async uploadTftGif(
    _frames: TftFrame[],
    _onProgress?: ProgressCallback,
    _opts?: UploadOptions,
  ): Promise<void> {
    unsupported('tftGif');
  }
  async setTftMode(_mode: string): Promise<void> {
    unsupported('tft', 'display mode switching has no verified command');
  }
  async getTftStatus(): Promise<TftStatus> {
    return unsupported('tft');
  }
  async syncClock(_date?: Date): Promise<void> {
    unsupported('tftClock');
  }
  async getBattery(): Promise<{ level: number; charging: boolean } | null> {
    return unsupported('battery');
  }
  async getPollingRate(): Promise<number> {
    return unsupported('pollingRate');
  }
  async setPollingRate(_hz: number): Promise<void> {
    unsupported('pollingRate');
  }
  getSettingsSchema(): SettingsSchema {
    return {};
  }
  async getSystemSettings(): Promise<SystemSettings> {
    return unsupported('sleep');
  }
  async setSystemSettings(_settings: SystemSettings): Promise<void> {
    unsupported('sleep');
  }
  async getSleepConfig(): Promise<{ sleepTime: number }> {
    const s = await this.getSystemSettings();
    if (s.sleepTime === undefined) unsupported('sleep');
    return { sleepTime: s.sleepTime };
  }
  async setSleepConfig(cfg: { sleepTime: number }): Promise<void> {
    const s = await this.getSystemSettings();
    await this.setSystemSettings({ ...s, sleepTime: cfg.sleepTime });
  }
  async getGameMode(): Promise<boolean> {
    return unsupported('gameMode');
  }
  async setGameMode(_enabled: boolean): Promise<void> {
    unsupported('gameMode');
  }
  async getKeyResponse(): Promise<number> {
    const s = await this.getSystemSettings();
    if (s.keyResponseTime === undefined) unsupported('keyResponse');
    return s.keyResponseTime;
  }
  async setKeyResponse(level: number): Promise<void> {
    await this.setSystemSettings({ ...(await this.getSystemSettings()), keyResponseTime: level });
  }
  async getWinLock(): Promise<boolean> {
    const s = await this.getSystemSettings();
    if (s.disableWinKey === undefined) unsupported('winLock');
    return s.disableWinKey;
  }
  async setWinLock(locked: boolean): Promise<void> {
    await this.setSystemSettings({ ...(await this.getSystemSettings()), disableWinKey: locked });
  }
  async getEncoder(): Promise<EncoderConfig> {
    return unsupported('encoder');
  }
  async setEncoder(_cfg: EncoderConfig): Promise<void> {
    unsupported('encoder');
  }
  async restoreDefaults(scope: 'keymap' | 'fnLayer' | 'macros' | 'lighting'): Promise<void> {
    unsupported('factoryDefaults', `no verified default-restore path for ${scope}`);
  }
}

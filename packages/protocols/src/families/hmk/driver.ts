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
  KeyAction,
  KeyActionKind,
  KeyboardLayout,
  KeymapState,
  LayerId,
  TransportMode,
} from '@openkey/core';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import { HMK_PROTOCOL_ID } from './constants.js';
import { HMK_BOOT_KEY, actionToHmk, hmkSpecials, hmkToAction } from './keycodes.js';
import { parseHmkMetadata } from './metadata.js';
import type { HmkMetadata } from './metadata.js';
import { HmkSession, gunzip } from './session.js';
import type { HmkActuation } from './session.js';

/**
 * libhmk driver: keymaps on every layer and the per-key Hall-effect settings (actuation point,
 * Rapid Trigger) of the active profile, read from the keyboard and read back after every write.
 * The layout comes from the keyboard's own metadata.
 */
export class HmkDriver extends BaseKeyboardDriver {
  readonly protocolId = HMK_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: HmkSession | null = null;
  firmwareVersion = 0;
  profile = 0;
  meta: HmkMetadata | null = null;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    private readonly open: (iface: HidInterfaceInfo) => Promise<HidTransport>,
  ) {
    super();
    this.transport = group.transportHint;
  }

  private s(): HmkSession {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  private m(): HmkMetadata {
    if (!this.meta) throw new ProtocolError('The keyboard metadata was not read.');
    return this.meta;
  }

  async connect(): Promise<void> {
    this.session = new HmkSession(await this.open(this.iface));
    this.firmwareVersion = await this.session.firmwareVersion();
    this.profile = await this.session.currentProfile();
    const json = new TextDecoder().decode(await gunzip(await this.session.metadataBytes()));
    this.meta = parseHmkMetadata(json);
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.transport.close().catch(() => undefined);
  }

  getLayout(): KeyboardLayout {
    return this.m().layout;
  }

  override getLayerIds(): readonly LayerId[] {
    return Array.from({ length: this.meta?.numLayers ?? 1 }, (_, i) => layerIdAt(i));
  }

  override getKeyActionKinds(): readonly KeyActionKind[] {
    return ['disabled', 'keyboard', 'consumer', 'system', 'mouse', 'layer', 'special', 'raw'];
  }

  override getSpecialActions(): readonly { code: number; label: string }[] {
    return hmkSpecials(this.meta?.numProfiles ?? 1);
  }

  override async getKeymap(layer: LayerId = 'base'): Promise<KeymapState> {
    const m = this.m();
    const codes = await this.s().readKeymap(this.profile, layerIndex(layer), m.numKeys);
    const slots: Record<number, KeyAction> = {};
    for (const k of m.layout.keys) slots[k.slot] = hmkToAction(codes[k.slot] ?? 0);
    return { layer, slots, provenance: 'device', updatedAt: new Date().toISOString() };
  }

  override async setKeymap(state: KeymapState): Promise<void> {
    const m = this.m();
    const L = layerIndex(state.layer);
    const before = await this.s().readKeymap(this.profile, L, m.numKeys);
    const after = Uint8Array.from(before);
    for (const [slotStr, action] of Object.entries(state.slots)) {
      const slot = Number(slotStr);
      if (action.kind === 'default' || slot >= m.numKeys) continue;
      const code = actionToHmk(action);
      if (code === null)
        throw new ProtocolError(
          'libhmk has no single keycode for this action (combine keys with an advanced key instead).',
        );
      if (code === HMK_BOOT_KEY && before[slot] !== HMK_BOOT_KEY)
        throw new ProtocolError('The bootloader key is never assigned by OpenKey.');
      after[slot] = code;
    }
    const changed = [...after.keys()].filter((i) => after[i] !== before[i]);
    if (!changed.length) return;
    // One write covering the changed range keeps the number of flash writes low.
    const first = Math.min(...changed);
    const last = Math.max(...changed);
    await this.s().writeKeymap(this.profile, L, first, [...after.subarray(first, last + 1)]);
    const back = await this.s().readKeymap(this.profile, L, m.numKeys);
    const wrong = changed.filter((i) => back[i] !== after[i]);
    if (wrong.length)
      throw new ReadbackMismatchError(`${wrong.length} key(s) did not keep their new keycode.`, {
        slots: wrong,
      });
  }

  override async getFnLayers(): Promise<KeymapState[]> {
    const out: KeymapState[] = [];
    for (let i = 1; i < (this.meta?.numLayers ?? 1); i++)
      out.push(await this.getKeymap(layerIdAt(i)));
    return out;
  }

  override async setFnLayers(layers: KeymapState[]): Promise<void> {
    for (const l of layers) await this.setKeymap(l);
  }

  /** Per-key actuation of the active profile, by key index. */
  async getActuations(): Promise<HmkActuation[]> {
    return this.s().readActuations(this.profile, this.m().numKeys);
  }

  /** Writes the given keys' actuation (one write for the changed range) and reads it back. */
  async setActuations(changes: Record<number, HmkActuation>): Promise<void> {
    const m = this.m();
    const before = await this.getActuations();
    const after = before.map((a, i) => changes[i] ?? a);
    for (const a of Object.values(changes))
      for (const v of [a.actuationPoint, a.rtDown, a.rtUp])
        if (!Number.isInteger(v) || v < 0 || v > 255)
          throw new ProtocolError('Actuation values are 0–255.');
    const idx = Object.keys(changes)
      .map(Number)
      .filter(
        (i) => i >= 0 && i < m.numKeys && JSON.stringify(after[i]) !== JSON.stringify(before[i]),
      );
    if (!idx.length) return;
    const first = Math.min(...idx);
    const last = Math.max(...idx);
    await this.s().writeActuations(this.profile, first, after.slice(first, last + 1));
    const back = await this.getActuations();
    if (idx.some((i) => JSON.stringify(back[i]) !== JSON.stringify(after[i])))
      throw new ReadbackMismatchError('The keyboard did not keep the new actuation settings.');
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const S = Evidence.OBSERVED;
    const src = 'libhmk raw HID commands (include/commands.h)';
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.VERIFIED,
      source: 'COMMAND_FIRMWARE_VERSION, COMMAND_GET_METADATA',
    });
    c.keymap = configurable('device', true, S, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: src,
      note: 'Read from the keyboard; every change is read back.',
    });
    const layers = this.meta?.numLayers ?? 1;
    c.fnLayer =
      layers > 1
        ? configurable('device', true, S, {
            safety: SafetyLevel.SAFE_PERSISTENT,
            source: src,
            value: `${layers} layers`,
          })
        : feature(FeatureStatus.NOT_SUPPORTED, {
            confidence: Evidence.VERIFIED,
            note: 'One layer.',
          });
    c.actuation = configurable('device', true, S, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: 'COMMAND_GET/SET_ACTUATION_MAP',
      value: 'per key, 0–255 of the travel',
    });
    c.rapidTrigger = configurable('device', true, S, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: 'COMMAND_GET/SET_ACTUATION_MAP (rt_down, rt_up, continuous)',
      value: 'per key, press and release sensitivity, continuous mode',
    });
    c.profiles = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.VERIFIED,
      value: `profile ${this.profile + 1} of ${this.meta?.numProfiles ?? 1} is edited`,
      note: 'OpenKey edits the active profile; switch profiles on the keyboard.',
    });
    c.calibration = feature(FeatureStatus.NOT_SUPPORTED, {
      confidence: S,
      note: 'Calibration, factory reset and the bootloader are left to the keyboard and hmkconf; OpenKey never sends them.',
    });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const id = this.group.identity;
    const v = this.firmwareVersion;
    return {
      model: this.meta?.name ?? id.productName ?? 'libhmk keyboard',
      profileId: `hmk-${id.vendorId.toString(16)}-${id.productId.toString(16)}`,
      identity: id,
      firmware: {
        version: `${v >> 8}.${v & 0xff}`,
        source: 'COMMAND_FIRMWARE_VERSION',
        confidence: Evidence.VERIFIED,
      },
      transport: this.transport,
      protocol: {
        id: this.protocolId,
        name: 'libhmk',
        revision: `0x${v.toString(16).padStart(4, '0')}`,
      },
      battery: null,
      fields: [
        {
          key: 'profile',
          label: 'Active profile',
          value: `${this.profile + 1} of ${this.meta?.numProfiles ?? 1}`,
          confidence: Evidence.VERIFIED,
          source: 'COMMAND_GET_PROFILE',
        },
        {
          key: 'keys',
          label: 'Keys',
          value: this.meta?.numKeys ?? 0,
          confidence: Evidence.VERIFIED,
          source: 'keyboard metadata',
        },
      ],
    };
  }
}

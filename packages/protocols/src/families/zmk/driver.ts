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
import type {
  ZmkBehaviorDetails,
  ZmkBinding,
  ZmkKeymap,
  ZmkPhysicalLayouts,
  ZmkResult,
} from './messages.js';
import { ZmkRpc } from './rpc.js';
import type { ByteChannel } from './rpc.js';

export const ZMK_PROTOCOL_ID = 'zmk-studio';

/** Behaviours that reboot, reset or switch the keyboard off: shown when present, never offered. */
const FORBIDDEN_BEHAVIORS = /^(bootloader|reset|soft off|system reset)$/i;
const SPECIAL_BASE = 0x10000;
const HID_KEYBOARD = 0x07;
const HID_CONSUMER = 0x0c;

type ResultKey = ZmkResult extends infer U ? (U extends unknown ? keyof U : never) : never;
type ResultOf<K extends ResultKey> = Extract<ZmkResult, { [P in K]: unknown }>[K];

/** The `k` part of an RPC result, or undefined when the keyboard answered something else. */
function pick<K extends ResultKey>(r: ZmkResult, k: K): ResultOf<K> | undefined {
  return k in r ? (r as unknown as Record<K, ResultOf<K>>)[k] : undefined;
}

/** Raw bytes of a binding OpenKey does not model: behaviour id, param1, param2 (32-bit LE each). */
function rawOf(b: ZmkBinding): number[] {
  const out: number[] = [];
  for (const v of [b.behaviorId, b.param1, b.param2])
    for (let i = 0; i < 4; i++) out.push((v >>> (8 * i)) & 0xff);
  return out;
}
function bindingOfRaw(bytes: number[]): ZmkBinding {
  const v = (at: number) =>
    ((bytes[at] ?? 0) |
      ((bytes[at + 1] ?? 0) << 8) |
      ((bytes[at + 2] ?? 0) << 16) |
      ((bytes[at + 3] ?? 0) << 24)) >>>
    0;
  return { behaviorId: v(0) | 0, param1: v(4), param2: v(8) };
}

/**
 * ZMK Studio driver (ZMK firmware with CONFIG_ZMK_STUDIO, over USB serial). The keymap is read from
 * the keyboard, every changed key is set with set_layer_binding, saved with save_changes and read
 * back. Writes need the keyboard unlocked with its Studio unlock key; OpenKey never unlocks it.
 */
export class ZmkStudioDriver extends BaseKeyboardDriver {
  readonly protocolId = ZMK_PROTOCOL_ID;
  readonly transport: TransportMode = 'usb';
  readonly rpc: ZmkRpc;
  name = 'ZMK keyboard';
  serial = '';
  locked = true;
  keymap: ZmkKeymap | null = null;
  layouts: ZmkPhysicalLayouts | null = null;
  readonly behaviors = new Map<number, ZmkBehaviorDetails>();
  private roles: Partial<Record<'kp' | 'none' | 'trans' | 'mo' | 'tog', number>> = {};
  private unlockWaiters: (() => void)[] = [];

  constructor(channel: ByteChannel, timeoutMs?: number) {
    super();
    this.rpc = new ZmkRpc(channel, timeoutMs);
    this.rpc.onNotification((m) => {
      if (m.kind !== 'notification' || !m.lockState) return;
      this.locked = m.lockState === 'locked';
      if (!this.locked) this.unlockWaiters.splice(0).forEach((w) => w());
    });
  }

  async connect(): Promise<void> {
    const info = pick(await this.rpc.call({ core: 'getDeviceInfo' }), 'deviceInfo');
    if (!info) throw new ProtocolError('The keyboard did not describe itself.');
    this.name = info.name || 'ZMK keyboard';
    this.serial = [...info.serialNumber].map((b) => b.toString(16).padStart(2, '0')).join('');
    const lock = pick(await this.rpc.call({ core: 'getLockState' }), 'lockState');
    this.locked = lock !== 'unlocked';
    if (!this.locked) await this.load();
  }

  /** Resolves once the user presses the Studio unlock key (or rejects after `ms`). */
  waitForUnlock(ms = 60000): Promise<void> {
    if (!this.locked) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ProtocolError('The keyboard was not unlocked in time.')),
        ms,
      );
      this.unlockWaiters.push(() => {
        clearTimeout(timer);
        resolve(this.load());
      });
    });
  }

  private async load(): Promise<void> {
    const ids = pick(await this.rpc.call({ behaviors: 'listAll' }), 'behaviors') ?? [];
    for (const id of ids) {
      const d = pick(await this.rpc.call({ behaviors: 'details', id }), 'behaviorDetails');
      if (d) this.behaviors.set(id, d);
    }
    const role = (name: RegExp, param?: 'hidUsage' | 'layerId') =>
      [...this.behaviors.values()].find(
        (b) =>
          name.test(b.displayName) &&
          (!param || b.metadata.some((m) => m.param1.some((p) => p.kind === param))),
      )?.id;
    this.roles = {
      kp: role(/^key ?press$/i, 'hidUsage'),
      none: role(/^none$/i),
      trans: role(/^transparent$/i),
      mo: role(/^momentary layer$/i, 'layerId'),
      tog: role(/^toggle layer$/i, 'layerId'),
    };
    this.layouts =
      pick(await this.rpc.call({ keymap: 'getPhysicalLayouts' }), 'physicalLayouts') ?? null;
    await this.refreshKeymap();
  }

  private async refreshKeymap(): Promise<ZmkKeymap> {
    const km = pick(await this.rpc.call({ keymap: 'getKeymap' }), 'keymap');
    if (!km) throw new ProtocolError('The keyboard did not return its keymap.');
    this.keymap = km;
    return km;
  }

  async disconnect(): Promise<void> {
    await this.rpc.close().catch(() => undefined);
  }

  getLayout(): KeyboardLayout {
    const layout =
      this.layouts?.layouts[this.layouts.activeLayoutIndex] ?? this.layouts?.layouts[0];
    const keys = (layout?.keys ?? []).map((k, i) => ({
      id: `k${i}`,
      label: '',
      slot: i,
      light: null,
      usage: 0,
      x: k.x / 100,
      y: k.y / 100,
      w: k.width / 100 || 1,
      h: k.height / 100 || 1,
    }));
    return {
      id: `zmk-${layout?.name ?? 'layout'}`,
      name: layout?.name ?? this.name,
      width: Math.max(1, ...keys.map((k) => k.x + k.w)),
      height: Math.max(1, ...keys.map((k) => k.y + k.h)),
      keys,
      source: 'ZMK Studio physical layout (from the keyboard)',
    };
  }

  override getLayerIds(): readonly LayerId[] {
    return Array.from({ length: Math.max(1, this.keymap?.layers.length ?? 1) }, (_, i) =>
      layerIdAt(i),
    );
  }

  override getKeyActionKinds(): readonly KeyActionKind[] {
    return ['disabled', 'keyboard', 'consumer', 'layer', 'special', 'raw'];
  }

  /** Behaviours without parameters (Transparent, Caps Word, Bluetooth clear …), minus the forbidden ones. */
  override getSpecialActions(): readonly { code: number; label: string }[] {
    return [...this.behaviors.values()]
      .filter(
        (b) =>
          !FORBIDDEN_BEHAVIORS.test(b.displayName) &&
          b.id !== this.roles.none &&
          b.metadata.every((m) => m.param1.length === 0 && m.param2.length === 0),
      )
      .map((b) => ({ code: SPECIAL_BASE + b.id, label: b.displayName }));
  }

  private decode(b: ZmkBinding): KeyAction {
    const r = this.roles;
    if (b.behaviorId === r.none) return { kind: 'disabled' };
    if (b.behaviorId === r.kp) {
      const page = (b.param1 >>> 16) & 0xff;
      const usage = b.param1 & 0xffff;
      const mods = b.param1 >>> 24;
      if (page === HID_KEYBOARD) return { kind: 'keyboard', usage, modifiers: mods };
      if (page === HID_CONSUMER && !mods) return { kind: 'consumer', usage };
    }
    const layers = this.keymap?.layers ?? [];
    if ((b.behaviorId === r.mo || b.behaviorId === r.tog) && !b.param2) {
      const index = layers.findIndex((l) => l.id === b.param1);
      if (index >= 0)
        return {
          kind: 'layer',
          layer: index,
          mode: b.behaviorId === r.mo ? 'momentary' : 'toggle',
        };
    }
    const d = this.behaviors.get(b.behaviorId);
    if (
      d &&
      !b.param1 &&
      !b.param2 &&
      d.metadata.every((m) => !m.param1.length && !m.param2.length)
    )
      return { kind: 'special', code: SPECIAL_BASE + b.behaviorId, label: d.displayName };
    return { kind: 'raw', bytes: rawOf(b) };
  }

  private encode(a: KeyAction): ZmkBinding {
    const r = this.roles;
    const need = (id: number | undefined, what: string) => {
      if (id === undefined) throw new ProtocolError(`This keyboard has no ${what} behaviour.`);
      return id;
    };
    switch (a.kind) {
      case 'disabled':
        return { behaviorId: need(r.none, 'None'), param1: 0, param2: 0 };
      case 'keyboard':
        return {
          behaviorId: need(r.kp, 'Key Press'),
          param1: (((a.modifiers & 0xff) << 24) | (HID_KEYBOARD << 16) | a.usage) >>> 0,
          param2: 0,
        };
      case 'consumer':
        return {
          behaviorId: need(r.kp, 'Key Press'),
          param1: (HID_CONSUMER << 16) | a.usage,
          param2: 0,
        };
      case 'layer': {
        const layer = this.keymap?.layers[a.layer];
        if (!layer) throw new ProtocolError(`Layer ${a.layer} does not exist.`);
        const id =
          a.mode === 'momentary' ? need(r.mo, 'Momentary Layer') : need(r.tog, 'Toggle Layer');
        return { behaviorId: id, param1: layer.id, param2: 0 };
      }
      case 'special': {
        const d = this.behaviors.get(a.code - SPECIAL_BASE);
        if (!d) throw new ProtocolError('This behaviour is not on the keyboard.');
        if (FORBIDDEN_BEHAVIORS.test(d.displayName))
          throw new ProtocolError(`${d.displayName} is never assigned by OpenKey.`);
        return { behaviorId: d.id, param1: 0, param2: 0 };
      }
      case 'raw':
        return bindingOfRaw(a.bytes);
      default:
        throw new ProtocolError(`ZMK keymaps cannot hold a ${a.kind} action.`);
    }
  }

  override async getKeymap(layer: LayerId = 'base'): Promise<KeymapState> {
    if (this.locked)
      throw new ProtocolError('Unlock the keyboard with its Studio unlock key first.');
    const km = this.keymap ?? (await this.refreshKeymap());
    const l = km.layers[layerIndex(layer)];
    if (!l) throw new ProtocolError(`Layer ${layer} does not exist.`);
    const slots: Record<number, KeyAction> = {};
    l.bindings.forEach((b, i) => (slots[i] = this.decode(b)));
    return { layer, slots, provenance: 'device', updatedAt: new Date().toISOString() };
  }

  override async setKeymap(state: KeymapState): Promise<void> {
    if (this.locked)
      throw new ProtocolError('Unlock the keyboard with its Studio unlock key first.');
    const km = await this.refreshKeymap();
    const L = layerIndex(state.layer);
    const layer = km.layers[L];
    if (!layer) throw new ProtocolError(`Layer ${state.layer} does not exist.`);
    const changes: [number, ZmkBinding][] = [];
    for (const [slotStr, action] of Object.entries(state.slots)) {
      const slot = Number(slotStr);
      if (action.kind === 'default') continue;
      const before = layer.bindings[slot];
      if (!before) continue;
      const after = this.encode(action);
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        const d = this.behaviors.get(after.behaviorId);
        if (d && FORBIDDEN_BEHAVIORS.test(d.displayName))
          throw new ProtocolError(`${d.displayName} is never assigned by OpenKey.`);
        changes.push([slot, after]);
      }
    }
    if (!changes.length) return;
    for (const [slot, binding] of changes) {
      const r = pick(
        await this.rpc.call({
          keymap: 'setLayerBinding',
          layerId: layer.id,
          keyPosition: slot,
          binding,
        }),
        'setLayerBinding',
      );
      if (r !== 'ok') {
        await this.rpc.call({ keymap: 'discardChanges' }).catch(() => undefined);
        throw new ProtocolError(
          `The keyboard refused key ${slot} (${r ?? 'no answer'}); nothing was saved.`,
        );
      }
    }
    const saved = pick(await this.rpc.call({ keymap: 'saveChanges' }), 'saveChanges');
    if (!saved || !saved.ok) throw new ProtocolError('The keyboard could not save the keymap.');
    const back = (await this.refreshKeymap()).layers[L]!;
    const wrong = changes.filter(
      ([slot, b]) => JSON.stringify(back.bindings[slot]) !== JSON.stringify(b),
    );
    if (wrong.length)
      throw new ReadbackMismatchError(`${wrong.length} key(s) did not keep their new binding.`, {
        slots: wrong.map(([s]) => s),
      });
  }

  override async getFnLayers(): Promise<KeymapState[]> {
    const out: KeymapState[] = [];
    for (let i = 1; i < (this.keymap?.layers.length ?? 1); i++)
      out.push(await this.getKeymap(layerIdAt(i)));
    return out;
  }

  override async setFnLayers(layers: KeymapState[]): Promise<void> {
    for (const l of layers) await this.setKeymap(l);
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const S = Evidence.OBSERVED;
    const src = 'ZMK Studio RPC (zmk-studio-messages, MIT)';
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.VERIFIED,
      source: 'core.get_device_info',
    });
    if (this.locked) {
      for (const f of ['keymap', 'fnLayer'] as const)
        c[f] = feature(FeatureStatus.UNKNOWN, {
          confidence: S,
          note: 'The keyboard is locked. Press its Studio unlock key, then reconnect.',
          source: src,
        });
      return c;
    }
    c.keymap = configurable('device', true, S, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: src,
      note: 'Read from the keyboard; changes are saved with save_changes and read back.',
    });
    const layers = this.keymap?.layers.length ?? 1;
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
    c.firmware = feature(FeatureStatus.NOT_SUPPORTED, {
      confidence: S,
      note: 'Bootloader and reset behaviours are never assigned by OpenKey.',
    });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      model: this.name,
      profileId: `zmk-${this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      identity: { vendorId: 0, productId: 0, productName: this.name },
      firmware: {
        version: null,
        source: 'ZMK Studio does not report a version',
        confidence: Evidence.UNKNOWN,
      },
      transport: this.transport,
      protocol: { id: this.protocolId, name: 'ZMK Studio', revision: 'RPC v1' },
      battery: null,
      fields: [
        {
          key: 'lock',
          label: 'Studio lock',
          value: this.locked ? 'locked' : 'unlocked',
          confidence: Evidence.VERIFIED,
          source: 'core.get_lock_state',
        },
        {
          key: 'layers',
          label: 'Layers',
          value: this.keymap?.layers.map((l) => l.name || `#${l.id}`).join(', ') ?? '—',
          confidence: Evidence.VERIFIED,
          source: 'keymap.get_keymap',
        },
        {
          key: 'behaviors',
          label: 'Behaviours',
          value: this.behaviors.size,
          confidence: Evidence.VERIFIED,
          source: 'behaviors.list_all_behaviors',
        },
      ],
    };
  }
}

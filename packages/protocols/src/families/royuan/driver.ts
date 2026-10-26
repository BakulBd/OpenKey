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
  sleep as realSleep,
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
  RgbConfig,
  TransportMode,
} from '@openkey/core';
import { describeAction, usageName } from '@openkey/core';
import type { PhysicalKey } from '@openkey/core';
import { getLayout } from '@openkey/devices';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import {
  Cmd,
  DELAY_MS,
  FLAG_FIXED,
  GEN2_WRITE_CHUNK,
  FLAG_RAINBOW,
  MAX_MODE,
  MODES,
  REPORT_BYTES,
  ROYUAN_PROTOCOL_ID,
} from './constants.js';
import { isAnswer, packet } from './packet.js';
import { SLOTS, SLOT_BYTES, WRITABLE_SLOTS, decodeSlot, encodeSlot } from './keymap.js';

const GRID_COLUMNS = 16;

export type RoyuanFamily = 'yc500' | 'gen2';

/** One command channel; every exchange is SET then GET, paced. */
export class RoyuanSession {
  constructor(
    readonly transport: HidTransport,
    private readonly delayMs = DELAY_MS,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {}

  /** Sends a GET-style command and returns the reply, or null when the firmware did not answer it. */
  async query(bytes: readonly number[]): Promise<Uint8Array | null> {
    const req = packet(bytes);
    await this.transport.sendFeatureReport(0, req);
    await this.sleep(this.delayMs);
    const reply = await this.transport.receiveFeatureReport(0, REPORT_BYTES);
    return isAnswer(reply, req) ? reply : null;
  }

  async write(
    bytes: readonly number[],
    checksum: 'bit7' | 'bit8',
    tail: readonly number[] = [],
  ): Promise<void> {
    await this.transport.sendFeatureReport(0, packet(bytes, checksum, tail));
    await this.sleep(this.delayMs);
  }

  /** Bulk page reads return raw page bytes without an opcode echo. */
  async page(bytes: readonly number[]): Promise<Uint8Array> {
    await this.transport.sendFeatureReport(0, packet(bytes));
    await this.sleep(this.delayMs);
    return this.transport.receiveFeatureReport(0, REPORT_BYTES);
  }
}

/** Identify reply → device id (the vendor's model record number). */
export const deviceIdOf = (r: Uint8Array): number =>
  (r[1]! | (r[2]! << 8) | (r[3]! << 16) | (r[4]! << 24)) >>> 0;

/**
 * Speed is a frame divider, inverted: yc500 takes 1..5 (host 0 → 5), gen2 takes 0..4 (host 4 → 0).
 */
export const speedToWire = (host: number, f: RoyuanFamily): number =>
  f === 'yc500' ? 5 - host : 4 - host;
export const speedFromWire = (wire: number, f: RoyuanFamily): number =>
  Math.max(0, Math.min(4, f === 'yc500' ? 5 - wire : 4 - wire));

/**
 * ROYUAN driver: identification, lighting (same opcode and payload in both command sets), and key
 * maps — read on both families, written on yc500 with single-slot writes and a read-back. Macros,
 * settings and the screen use opcodes that mean different things per family and are not written.
 */
export class RoyuanDriver extends BaseKeyboardDriver {
  readonly protocolId = ROYUAN_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: RoyuanSession | null = null;
  family: RoyuanFamily = 'gen2';
  firmware: string | null = null;
  profile = 0;
  /** Base-layer slots as read at connect; they label the keys and shape the layout. */
  private base: Uint8Array | null = null;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    readonly deviceId: number,
    private readonly opts: {
      open: (i: HidInterfaceInfo) => Promise<HidTransport>;
      delayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    super();
    this.transport = group.transportHint;
  }

  private s(): RoyuanSession {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  async connect(): Promise<void> {
    this.session = new RoyuanSession(
      await this.opts.open(this.iface),
      this.opts.delayMs ?? DELAY_MS,
      this.opts.sleep,
    );
    const rev = await this.session.query([Cmd.REVISION]);
    const word = rev ? (rev[2]! << 8) | rev[1]! : 0;
    if (word) {
      this.family = 'yc500';
      this.firmware = word.toString(16);
    } else {
      this.family = 'gen2';
      const id = await this.session.query([Cmd.IDENTIFY]);
      const v = id ? (id[8]! << 8) | id[7]! : 0;
      this.firmware = v ? v.toString(16) : null;
    }
    const p = await this.session.query([
      this.family === 'yc500' ? Cmd.GET_PROFILE_YC500 : Cmd.GET_PROFILE_GEN2,
    ]);
    this.profile = p && p[1]! <= 3 ? p[1]! : 0;
    this.base = await this.readTable('base').catch(() => null);
  }

  /** Reads one layer's 512-byte slot table (eight 64-byte pages). */
  private async readTable(layer: 'base' | 'fn'): Promise<Uint8Array> {
    if (layer === 'fn' && this.family !== 'yc500')
      throw new ProtocolError('The Fn layer of gen2 boards is not read yet.');
    const out = new Uint8Array(SLOTS * SLOT_BYTES);
    for (let page = 0; page < 8; page++) {
      const req =
        this.family === 'yc500'
          ? [layer === 'fn' ? Cmd.GET_FN_YC500 : Cmd.GET_KEYMAP_YC500, this.profile, page]
          : [Cmd.GET_KEYMAP_GEN2, this.profile, 0xff, page, 0];
      out.set((await this.s().page(req)).subarray(0, 64), page * 64);
    }
    return out;
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.transport.close().catch(() => undefined);
  }

  /**
   * Which physical key a slot is depends on the board, so the layout is a grid of the slots that
   * hold a key on the base layer, each labelled with what it types. Falls back to a generic board.
   */
  getLayout(): KeyboardLayout {
    if (!this.base) return getLayout('ak820-pro');
    const keys: PhysicalKey[] = [];
    for (let slot = 0; slot < SLOTS; slot++) {
      const a = decodeSlot(this.base.subarray(slot * 4, slot * 4 + 4), false, this.gen2);
      if (a.kind === 'disabled') continue;
      const n: number = keys.length;
      keys.push({
        id: `s${slot}`,
        label: describeAction(a, usageName),
        slot,
        light: null,
        usage: a.kind === 'keyboard' ? a.usage : 0,
        x: n % GRID_COLUMNS,
        y: Math.floor(n / GRID_COLUMNS),
        w: 1,
        h: 1,
      });
    }
    return {
      id: `royuan-${this.deviceId}`,
      name: 'Key slots (labelled by the base layer)',
      width: Math.min(GRID_COLUMNS, keys.length),
      height: Math.ceil(keys.length / GRID_COLUMNS),
      keys,
      source: 'base-layer read',
    };
  }

  override getKeyActionKinds(): readonly KeyActionKind[] {
    return ['default', 'disabled', 'keyboard', 'consumer'];
  }

  override getLayerIds(): readonly LayerId[] {
    return this.family === 'yc500' ? ['base', 'fn'] : ['base'];
  }

  override async getKeymap(layer: LayerId = 'base'): Promise<KeymapState> {
    const fn = layer !== 'base';
    const table = fn ? await this.readTable('fn') : await this.readTable('base');
    const slots: Record<number, KeyAction> = {};
    for (const k of this.getLayout().keys)
      slots[k.slot] = decodeSlot(table.subarray(k.slot * 4, k.slot * 4 + 4), fn, this.gen2);
    return {
      layer: fn ? 'fn' : 'base',
      slots,
      provenance: 'device',
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * yc500 single-slot writes, one per changed key, then a read-back of the whole layer. Some yc500
   * firmware drops single-slot writes; the read-back reports that instead of assuming success.
   */
  private get gen2(): boolean {
    return this.family === 'gen2';
  }

  override async setKeymap(state: KeymapState): Promise<void> {
    if (this.gen2) return this.setKeymapGen2(state);
    const fn = state.layer !== 'base';
    const before = await this.readTable(fn ? 'fn' : 'base');
    const changes: [number, number[]][] = [];
    for (const [slotStr, action] of Object.entries(state.slots)) {
      const slot = Number(slotStr);
      const value = encodeSlot(action, fn);
      const old = Array.from(before.subarray(slot * 4, slot * 4 + 4));
      if (value.every((b, i) => b === old[i])) continue;
      if (slot >= WRITABLE_SLOTS) throw new ProtocolError(`Slot ${slot} is not written.`);
      changes.push([slot, value]);
    }
    for (const [slot, value] of changes)
      await this.s().write(
        [fn ? Cmd.SET_FN_KEY_YC500 : Cmd.SET_KEY_YC500, this.profile, slot],
        'bit7',
        value,
      );
    if (!changes.length) return;
    const after = await this.readTable(fn ? 'fn' : 'base');
    const missed = changes.filter(([slot, v]) => v.some((b, i) => after[slot * 4 + i] !== b));
    if (missed.length)
      throw new ReadbackMismatchError(
        `The keyboard did not keep ${missed.length} key(s). This firmware may ignore single-key writes.`,
        { slots: missed.map(([slot]) => slot) },
      );
  }

  /**
   * gen2: the whole base layer (126 slots) in nine packets, as RK's own web driver writes it, then a
   * read-back of the layer. Slots 126 and 127 are not part of the write.
   */
  private async setKeymapGen2(state: KeymapState): Promise<void> {
    if (state.layer !== 'base')
      throw new ProtocolError('Only the base layer is written on gen2 boards.');
    const before = await this.readTable('base');
    const next = before.slice(0, WRITABLE_SLOTS * SLOT_BYTES);
    const changed: number[] = [];
    for (const [slotStr, action] of Object.entries(state.slots)) {
      const slot = Number(slotStr);
      const value = encodeSlot(action, false, true);
      const old = Array.from(before.subarray(slot * 4, slot * 4 + 4));
      if (value.every((b, i) => b === old[i])) continue;
      if (slot >= WRITABLE_SLOTS) throw new ProtocolError(`Slot ${slot} is not written.`);
      next.set(value, slot * 4);
      changed.push(slot);
    }
    if (!changed.length) return;
    const pages = Math.ceil(next.length / GEN2_WRITE_CHUNK);
    for (let page = 0; page < pages; page++) {
      const chunk = next.subarray(page * GEN2_WRITE_CHUNK, (page + 1) * GEN2_WRITE_CHUNK);
      await this.s().write(
        [
          Cmd.SET_KEYMAP_GEN2,
          this.profile,
          0xff,
          page,
          chunk.length,
          page === pages - 1 ? 1 : 0,
          0,
        ],
        'bit7',
        Array.from(chunk),
      );
    }
    await (this.opts.sleep ?? realSleep)(this.opts.delayMs === 0 ? 0 : 50);
    const after = await this.readTable('base');
    const missed = changed.filter((slot) =>
      next.subarray(slot * 4, slot * 4 + 4).some((b, i) => after[slot * 4 + i] !== b),
    );
    if (missed.length)
      throw new ReadbackMismatchError(`The keyboard did not keep ${missed.length} key(s).`, {
        slots: missed,
      });
    this.base = after;
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.VERIFIED,
      source: 'identify 0x8F',
    });
    c.rgb =
      this.transport === 'usb'
        ? configurable('device', true, Evidence.INFERRED, {
            safety: SafetyLevel.SAFE_PERSISTENT,
            source: 'LEDPARAM 0x87/0x07 (sharkfin, hardware-tested on other boards)',
            note: 'Some boards swap “fixed colour” and “rainbow”; the brightness range is 0–4 on most boards.',
          })
        : feature(FeatureStatus.TRANSPORT_LIMITED, {
            confidence: Evidence.INFERRED,
            note: 'Through the receiver every packet must be relayed; connect the cable.',
          });
    const usb = this.transport === 'usb';
    c.keymap = !usb
      ? feature(FeatureStatus.TRANSPORT_LIMITED, { confidence: Evidence.INFERRED })
      : this.family === 'yc500'
        ? configurable('device', true, Evidence.INFERRED, {
            safety: SafetyLevel.SAFE_PERSISTENT,
            source: 'sharkfin: 0x89 read, 0x13 single-slot write (hardware-tested)',
            note: 'Keys are labelled by what they type on the base layer. Every write is read back.',
          })
        : configurable('device', true, Evidence.INFERRED, {
            safety: SafetyLevel.SAFE_PERSISTENT,
            source:
              'RK’s own web driver (drive.rkgaming.com, ROYUAN SET_KEYMATRIX 0x0A): the whole layer in nine packets; read with 0x8A',
            value: 'keys, a key with one modifier, media keys, disabled',
            note: 'Keys are labelled by what they type on the base layer. The whole layer is written and read back.',
          });
    c.fnLayer =
      usb && this.family === 'yc500'
        ? configurable('device', true, Evidence.INFERRED, { safety: SafetyLevel.SAFE_PERSISTENT })
        : feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, { confidence: Evidence.INFERRED });
    for (const f of ['macros', 'sleep', 'debounce', 'tft'] as const)
      c[f] = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
        confidence: Evidence.INFERRED,
        note: 'The two ROYUAN command sets use these opcodes for different registers; OpenKey writes them only after the family is verified on hardware.',
      });
    c.factoryDefaults = feature(FeatureStatus.NOT_SUPPORTED, {
      confidence: Evidence.OBSERVED,
      note: 'Factory reset exists; OpenKey never sends it.',
    });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const id = this.group.identity;
    return {
      model: id.productName || 'ROYUAN keyboard',
      profileId: `royuan-${this.deviceId}`,
      identity: id,
      firmware: {
        version: this.firmware,
        source: this.family === 'yc500' ? 'GET 0x80' : 'identify bytes 7..8',
        confidence: this.firmware ? Evidence.OBSERVED : Evidence.UNKNOWN,
      },
      transport: this.transport,
      protocol: { id: this.protocolId, name: `ROYUAN (${this.family})` },
      battery: null,
      fields: [
        {
          key: 'deviceId',
          label: 'Device record',
          value: this.deviceId,
          confidence: Evidence.VERIFIED,
          source: 'identify 0x8F',
        },
        {
          key: 'family',
          label: 'Command set',
          value: this.family,
          confidence: Evidence.OBSERVED,
          source: 'GET 0x80 (zeros on gen2)',
        },
      ],
    };
  }

  override getRgbEffects(): EffectCatalog {
    return {
      effects: MODES.map(([id, name]) => ({
        id,
        name,
        controls: { color: true, colorful: true, brightness: true, speed: id !== 1, direction: [] },
      })),
      brightness: { min: 0, max: 4 },
      speed: { min: 0, max: 4 },
    };
  }

  private async readLed(): Promise<Uint8Array> {
    const r = await this.s().query([Cmd.GET_LEDPARAM]);
    if (!r) throw new ProtocolError('The keyboard did not answer the lighting read.');
    return r;
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    const r = await this.readLed();
    const flags = r[4]! & 0x0f;
    return {
      effect: r[1]!,
      speed: speedFromWire(r[2]!, this.family),
      brightness: r[3]!,
      colorful: flags === FLAG_RAINBOW,
      color: { r: r[5]!, g: r[6]!, b: r[7]! },
      direction: 'right',
    };
  }

  override async setRgbConfig(config: RgbConfig): Promise<void> {
    if (!MODES.some(([id]) => id === config.effect) || config.effect > MAX_MODE)
      throw new ProtocolError(`Lighting mode ${config.effect} is not offered for this family.`);
    const before = await this.readLed();
    const option = before[4]! >> 4;
    const clampB = Math.max(0, Math.min(4, Math.round(config.brightness)));
    const speed = speedToWire(Math.max(0, Math.min(4, Math.round(config.speed))), this.family);
    // Pure white is sent as FA FA FA, as the vendor software does.
    const c = (v: number) => Math.min(0xfa, Math.max(0, Math.round(v)));
    const body = [
      Cmd.SET_LEDPARAM,
      config.effect,
      speed,
      clampB,
      (option << 4) | (config.colorful ? FLAG_RAINBOW : FLAG_FIXED),
      c(config.color.r),
      c(config.color.g),
      c(config.color.b),
    ];
    await this.s().write(body, 'bit8');
    const after = await this.readLed();
    const bad = [1, 2, 3, 4, 5, 6, 7].filter((i) => after[i] !== body[i]);
    if (bad.length)
      throw new ReadbackMismatchError('The keyboard did not keep the lighting setting.', {
        bytes: bad,
      });
  }
}

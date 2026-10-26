import {
  BaseKeyboardDriver,
  Evidence,
  FeatureStatus,
  ProtocolError,
  ReadbackMismatchError,
  SafetyLevel,
  TimeoutError,
  configurable,
  emptyCapabilities,
  feature,
} from '@openkey/core';
import type {
  Capabilities,
  DeviceInfo,
  EffectCatalog,
  KeyActionKind,
  KeyboardLayout,
  KeymapState,
  LayerId,
  LightZone,
  Macro,
  MacroLimits,
  PerKeyRgb,
  RgbConfig,
  TransportMode,
} from '@openkey/core';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import {
  BRIGHTNESS_MAX,
  CUSTOM_MODE,
  Cmd,
  EFFECT_BYTES,
  HUB_PROTOCOL_ID,
  KEY_TABLE_BYTES,
  TABLE_BYTES,
  ZONE_BYTES,
  decodeKey,
  encodeKey,
  ZONE_COLOR_OFFSET,
  decodeEffect,
  decodeInfo,
  decodeTable,
  encodeEffect,
  encodeTable,
  isEffectBlock,
  parseReply,
  requests,
} from './codec.js';
import type { HubEffect, HubInfo, TransferOptions } from './codec.js';
import { MACRO_INDEX_BYTES, MACRO_SLOTS } from '../sonix-aa55/constants.js';
import { decodeMacroBlock, encodeMacrosAa55 } from '../sonix-aa55/codecs.js';
import { hubLayout } from './models.js';
import type { HubModel, HubZone } from './models.js';

/** One transfer at a time; each packet waits for its own reply before the next is sent. */
export class HubSession {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly transport: HidTransport,
    readonly reportSize: number,
    private readonly replyMs: number,
  ) {}

  transfer(cmd: number, data: Uint8Array, opts: TransferOptions = {}): Promise<Uint8Array> {
    const offset = opts.offset ?? 0;
    const run = async () => {
      const out = new Uint8Array(data.length);
      for (const req of requests(cmd, data, this.reportSize, opts)) {
        this.transport.drainInput();
        await this.transport.sendOutputReport(0, req);
        const addr = req[3]! | (req[4]! << 8);
        const deadline = Date.now() + this.replyMs;
        for (;;) {
          const r = await this.transport.readInputReport(Math.max(1, deadline - Date.now()));
          if (!r)
            throw new TimeoutError(
              'The keyboard did not answer (asleep or out of range? press a key to wake it).',
            );
          const reply = parseReply(r);
          if (reply && reply.cmd === cmd && reply.addr === addr) {
            const at = addr - offset;
            out.set(reply.data.subarray(0, Math.min(reply.data.length, data.length - at)), at);
            break;
          }
          if (Date.now() >= deadline) throw new TimeoutError('The keyboard did not answer.');
        }
      }
      return out;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  read(cmd: number, bytes: number, offset = 0): Promise<Uint8Array> {
    return this.transfer(cmd, new Uint8Array(bytes), { offset });
  }
}

const builtIn = (n: number) => `Built-in effect ${n}`;

/**
 * AULA F87S 8K and AJAZZ AK680 V2 / MAX: device info and battery; lighting effect, colour,
 * brightness and speed where the keyboard answers the lighting read; per-key colours on models whose
 * LED map is confirmed. Everything is read from the keyboard, changed in place and read back.
 */
export class HubDriver extends BaseKeyboardDriver {
  readonly protocolId = HUB_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: HubSession | null = null;
  info: HubInfo | null = null;
  /** Whether the keyboard answered the lighting read with a valid block. */
  lighting = false;
  /** Zones whose block the keyboard returned on connection. */
  private zonesRead: HubZone[] = [];
  private readonly layout: KeyboardLayout | null;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    readonly model: HubModel,
    private readonly reportSize: number,
    private readonly open: (i: HidInterfaceInfo) => Promise<HidTransport>,
  ) {
    super();
    this.transport = group.transportHint;
    this.layout = hubLayout(model);
  }

  private s(): HubSession {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  /** True when the keyboard the receiver relays is the model this entry describes. */
  get bodyMatches(): boolean {
    return (
      !!this.info &&
      this.info.vendorId === this.model.body.vendorId &&
      this.info.productId === this.model.body.productId
    );
  }

  private get perKey(): boolean {
    return !!this.model.ledMap && this.bodyMatches && this.lighting;
  }

  async connect(): Promise<void> {
    this.session = new HubSession(
      await this.open(this.iface),
      this.reportSize,
      this.model.link === 'usb' ? 1000 : 2500,
    );
    this.info = decodeInfo(await this.session.read(Cmd.DEVICE_INFO, this.model.infoBytes));
    // Only a valid answer to the lighting read enables lighting; a model without it times out here.
    const block = await this.session.read(Cmd.GET_LED_EFFECT, EFFECT_BYTES).catch(() => null);
    this.lighting = !!block && isEffectBlock(block) && this.bodyMatches;
    this.zonesRead = [];
    if (this.bodyMatches)
      for (const z of this.model.zones ?? [])
        if (await this.session.read(z.read, ZONE_BYTES).catch(() => null)) this.zonesRead.push(z);
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.transport.close().catch(() => undefined);
  }

  getLayout(): KeyboardLayout {
    return (
      this.layout ?? {
        id: 'hub',
        name: this.model.name,
        width: 1,
        height: 1,
        keys: [],
        source: 'no layout is confirmed for this model',
      }
    );
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const ev = this.model.ledMap ? Evidence.OBSERVED : Evidence.INFERRED;
    const src = this.model.source;
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.OBSERVED,
      source: 'device info (0x10)',
    });
    if (this.info?.battery !== null && this.info?.battery !== undefined)
      c.battery = feature(FeatureStatus.READ_ONLY, {
        read: 'device',
        confidence: Evidence.OBSERVED,
        source: 'device info (0x10)',
      });
    const other =
      this.info && !this.bodyMatches
        ? `The receiver is paired with another keyboard (${this.info.vendorId.toString(16).padStart(4, '0')}:${this.info.productId.toString(16).padStart(4, '0')}); OpenKey changes nothing through it.`
        : null;
    c.rgb = this.lighting
      ? configurable('device', true, ev, {
          safety: SafetyLevel.SAFE_PERSISTENT,
          source: src,
          value: 'effect, colour, brightness 0–5 and speed',
          note: 'Read from the keyboard; only the changed fields are written, then read back.',
        })
      : feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
          confidence: Evidence.INFERRED,
          note: other ?? 'The keyboard did not answer the lighting read; lighting is left alone.',
        });
    c.perKeyRgb = this.perKey
      ? configurable('device', true, ev, {
          safety: SafetyLevel.SAFE_PERSISTENT,
          source: src,
          value: `${Object.keys(this.model.ledMap!).length} keys`,
          note: this.model.ledAssumed
            ? 'LEDs are numbered like the keys, as on the AULA F87S, but not confirmed on this board: if colours land on the wrong keys, report it. The whole table is read, changed, written back and read again.'
            : 'The whole 128-slot table is read, changed and written back, then read again.',
        })
      : feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
          confidence: Evidence.INFERRED,
          note: other ?? 'The LED map of this model is not confirmed yet.',
        });
    if (this.zonesRead.length)
      c.lightZones = configurable(
        'device',
        true,
        this.transport === '2.4ghz' ? Evidence.OBSERVED : Evidence.INFERRED,
        {
          safety: SafetyLevel.SAFE_PERSISTENT,
          source: `${src}; zone blocks 0x1B/0x1D read, 0x2B/0x2D written (HID-PROTOCOL.md §5.5)`,
          value: this.zonesRead.map((z) => z.name).join(', '),
          note: 'One colour per zone. OpenKey reads each zone, changes only its colour, writes it back and reads it again; the zone’s other settings stay as they are.',
        },
      );
    if (this.keymapOk) {
      const keys = {
        safety: SafetyLevel.CAUTION,
        source:
          'AJAZZ’s own web driver (ajazz.driveall.cn): key tables 0x12/0x22 and Fn layer 0x16/0x26, 128 keys × 4 bytes',
        note: 'Read from the keyboard; the whole table is written back with your changes and read again. Fn keeps its function. Restore defaults returns every key to its factory function.',
      };
      c.keymap = configurable('device', true, Evidence.INFERRED, {
        ...keys,
        value: 'keys, media keys, mouse buttons and wheel',
      });
      c.fnLayer = configurable('device', true, Evidence.INFERRED, { ...keys, value: 'Fn layer' });
      c.factoryDefaults = configurable('none', true, Evidence.INFERRED, {
        safety: SafetyLevel.CAUTION,
        note: 'Writes the "factory function" entry to every key of the layer (the keyboard keeps its own defaults); lighting stays as it is.',
      });
      if (this.macrosOk)
        c.macros = configurable('device', true, Evidence.INFERRED, {
          safety: SafetyLevel.CAUTION,
          source:
            'AJAZZ’s own web driver (ajazz.driveall.cn): macro storage 0x15/0x25 (400-byte index, then blocks of 4-byte steps)',
          value: `${MACRO_SLOTS} slots, ${this.info!.macroSpace} bytes`,
          note: 'Not yet run on a keyboard by OpenKey: macros are written whole and read back. Assign a macro to a key on the Keys page.',
        });
    } else
      c.keymap = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
        confidence: Evidence.INFERRED,
        note: other ?? 'The key numbers of this model are not known yet.',
      });
    if (this.model.name.includes('AK680'))
      c.actuation = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
        confidence: Evidence.INFERRED,
        note: 'Magnetic switches: actuation and Rapid Trigger are read by community tools but not written with read-back yet; use the AJAZZ web driver.',
      });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const i = this.info;
    return {
      model: this.model.name,
      profileId: `hub-${this.model.productId.toString(16)}`,
      identity: this.group.identity,
      firmware: {
        version: i?.firmware ?? null,
        source: 'device info (0x10)',
        confidence: Evidence.OBSERVED,
      },
      transport: this.transport,
      protocol: { id: this.protocolId, name: 'AULA/AJAZZ web-driver protocol (AA/55)' },
      battery: i && i.battery !== null ? { level: i.battery, charging: i.charging === 1 } : null,
      fields: i
        ? [
            {
              key: 'body',
              label: 'Keyboard',
              value: `${i.vendorId.toString(16).padStart(4, '0')}:${i.productId.toString(16).padStart(4, '0')}${this.bodyMatches ? '' : ' (not this model)'}`,
              confidence: Evidence.VERIFIED,
              source: 'device info (0x10)',
            },
          ]
        : [],
    };
  }

  override async getBattery(): Promise<{ level: number; charging: boolean } | null> {
    const i = decodeInfo(await this.s().read(Cmd.DEVICE_INFO, this.model.infoBytes));
    this.info = i;
    return i.battery !== null ? { level: i.battery, charging: i.charging === 1 } : null;
  }

  private requireLighting(): void {
    if (!this.lighting)
      throw new ProtocolError('Lighting is not available on this keyboard or link.');
  }

  private async effect(): Promise<HubEffect> {
    return decodeEffect(await this.s().read(Cmd.GET_LED_EFFECT, EFFECT_BYTES));
  }

  override getRgbEffects(): EffectCatalog {
    const effects = Array.from({ length: 19 }, (_, i) => ({
      id: i + 1,
      name: builtIn(i + 1),
      controls: { color: true, colorful: false, brightness: true, speed: true, direction: [] },
    }));
    if (this.perKey)
      effects.push({
        id: CUSTOM_MODE,
        name: 'Custom (per-key colours)',
        controls: { color: false, colorful: false, brightness: true, speed: false, direction: [] },
      });
    return {
      effects,
      brightness: {
        min: this.model.web?.brightness?.[0] ?? 0,
        max: this.model.web?.brightness?.[1] ?? BRIGHTNESS_MAX,
      },
      speed: { min: this.model.web?.speed?.[0] ?? 0, max: this.model.web?.speed?.[1] ?? 5 },
      ...(this.perKey ? { customEffect: CUSTOM_MODE } : {}),
    };
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    this.requireLighting();
    const e = await this.effect();
    return {
      effect: e.mode,
      color: e.color,
      colorful: false,
      brightness: e.brightness,
      speed: e.speed,
      direction: 'right',
    };
  }

  private async writeEffect(e: Omit<HubEffect, 'raw'>): Promise<void> {
    const base = await this.effect();
    const block = encodeEffect(base.raw, e);
    await this.s().transfer(Cmd.SET_LED_EFFECT, block);
    const back = (await this.effect()).raw;
    for (const i of [0, 1, 2, 3, 9, 10])
      if (back[i] !== block[i])
        throw new ReadbackMismatchError(
          `The keyboard did not keep the lighting change (byte ${i}).`,
        );
  }

  override async setRgbConfig(c: RgbConfig): Promise<void> {
    this.requireLighting();
    if (c.effect === CUSTOM_MODE && !this.perKey)
      throw new ProtocolError('Custom per-key lighting is not available here.');
    await this.writeEffect({
      mode: c.effect,
      color: c.color,
      brightness: c.brightness,
      speed: c.speed,
    });
  }

  private requirePerKey(): Record<string, number> {
    if (!this.perKey)
      throw new ProtocolError('Per-key colours are not available on this keyboard or link.');
    return this.model.ledMap!;
  }

  override async getPerKeyRgb(): Promise<PerKeyRgb> {
    const map = this.requirePerKey();
    const table = decodeTable(await this.s().read(Cmd.GET_CUSTOM_LED, TABLE_BYTES));
    return Object.fromEntries(Object.values(map).map((slot) => [slot, table[slot]!]));
  }

  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    const map = this.requirePerKey();
    const slots = new Set(Object.values(map));
    const table = decodeTable(await this.s().read(Cmd.GET_CUSTOM_LED, TABLE_BYTES));
    for (const [k, v] of Object.entries(colors)) {
      const slot = Number(k);
      if (!slots.has(slot)) throw new ProtocolError(`LED ${slot} is not a key of this keyboard.`);
      table[slot] = v;
    }
    const block = encodeTable(table);
    await this.s().transfer(Cmd.SET_CUSTOM_LED, block);
    const back = decodeTable(await this.s().read(Cmd.GET_CUSTOM_LED, TABLE_BYTES));
    for (const slot of slots)
      if (JSON.stringify(back[slot]) !== JSON.stringify(table[slot]))
        throw new ReadbackMismatchError(`The keyboard did not keep the colour of LED ${slot}.`);
    // Show the table: custom mode, keeping the brightness unless the lights are off.
    const e = await this.effect();
    await this.writeEffect({
      mode: CUSTOM_MODE,
      color: e.color,
      brightness: e.brightness > 0 ? e.brightness : BRIGHTNESS_MAX,
      speed: e.speed,
    });
  }

  override async getLightZones(): Promise<LightZone[]> {
    const out: LightZone[] = [];
    for (const z of this.zonesRead) {
      const b = await this.s().read(z.read, ZONE_BYTES);
      const o = ZONE_COLOR_OFFSET;
      out.push({ id: z.id, name: z.name, color: { r: b[o]!, g: b[o + 1]!, b: b[o + 2]! } });
    }
    return out;
  }

  /**
   * Reads each zone's block and writes it back with only the colour changed (the source: a block
   * built from scratch blanked the zone after a preset change), then reads it again.
   */
  override async setLightZones(zones: Pick<LightZone, 'id' | 'color'>[]): Promise<void> {
    for (const { id, color } of zones) {
      const z = this.zonesRead.find((x) => x.id === id);
      if (!z) throw new ProtocolError(`Zone “${id}” is not available on this keyboard.`);
      const block = (await this.s().read(z.read, ZONE_BYTES)).slice();
      block.set(
        [color.r, color.g, color.b].map((v) => Math.max(0, Math.min(255, Math.round(v)))),
        ZONE_COLOR_OFFSET,
      );
      await this.s().transfer(z.write, block);
      const back = await this.s().read(z.read, ZONE_BYTES);
      if (back.some((v, i) => v !== block[i]))
        throw new ReadbackMismatchError(`The keyboard did not keep the colour of the ${z.name}.`);
    }
  }

  /** Key maps: a model whose key numbers are known, and the keyboard the receiver relays is it. */
  private get keymapOk(): boolean {
    return !!this.model.keys && this.bodyMatches;
  }

  private requireKeymap(): void {
    if (!this.keymapOk) throw new ProtocolError('Key maps are not available for this keyboard.');
  }

  override getLayerIds(): readonly LayerId[] {
    return this.keymapOk ? ['base', 'fn'] : ['base'];
  }

  override getKeyActionKinds(): readonly KeyActionKind[] {
    if (!this.keymapOk) return super.getKeyActionKinds();
    const kinds: KeyActionKind[] = ['default', 'keyboard', 'consumer', 'mouse'];
    return this.macrosOk ? [...kinds, 'macro'] : kinds;
  }

  /** Macro storage: key maps work, the keyboard reports macro space and the web driver offers it. */
  private get macrosOk(): boolean {
    return (
      this.keymapOk &&
      (this.info?.macroSpace ?? 0) > MACRO_INDEX_BYTES &&
      (!this.model.web || this.model.web.routes.includes('macro'))
    );
  }

  override getMacroLimits(): MacroLimits {
    return {
      slots: MACRO_SLOTS,
      storageBytes: this.info?.macroSpace ?? 0,
      minDelayMs: 0,
      maxDelayMs: 0xffff,
    };
  }

  private async readMacroStorage(): Promise<{ index: Uint8Array; blocks: Map<number, Uint8Array> }> {
    const s = this.s();
    const index = await s.read(Cmd.GET_MACRO, MACRO_INDEX_BYTES);
    const view = new DataView(index.buffer, index.byteOffset, index.byteLength);
    const space = this.info!.macroSpace;
    const blocks = new Map<number, Uint8Array>();
    for (let i = 0; i < MACRO_SLOTS; i++) {
      const addr = view.getUint32(i * 4, true);
      if (!addr) continue;
      if (addr < MACRO_INDEX_BYTES || addr + 4 > space)
        throw new ProtocolError(`Macro ${i + 1} points outside the macro storage.`);
      const head = await s.read(Cmd.GET_MACRO, 4, addr);
      const steps = Math.floor((head[0]! | (head[1]! << 8)) / 2);
      if (addr + 4 + steps * 4 > space)
        throw new ProtocolError(`Macro ${i + 1} runs past the macro storage.`);
      const body = steps ? await s.read(Cmd.GET_MACRO, steps * 4, addr + 4) : new Uint8Array();
      const block = new Uint8Array(4 + body.length);
      block.set(head);
      block.set(body, 4);
      blocks.set(i, block);
    }
    return { index, blocks };
  }

  override async getMacros(): Promise<Macro[]> {
    if (!this.macrosOk) throw new ProtocolError('Macros are not available for this keyboard.');
    const { blocks } = await this.readMacroStorage();
    return [...blocks].map(([index, b]) => ({
      index,
      events: decodeMacroBlock(b.subarray(4), Math.floor((b[0]! | (b[1]! << 8)) / 2)),
    }));
  }

  /** Writes the whole macro storage (index without the last flag, then the blocks) and reads it back. */
  override async setMacros(macros: Macro[]): Promise<void> {
    if (!this.macrosOk) throw new ProtocolError('Macros are not available for this keyboard.');
    const { index, data } = encodeMacrosAa55(macros);
    if (index.length + data.length > this.info!.macroSpace)
      throw new ProtocolError(
        `The macros need ${index.length + data.length} bytes; the keyboard has ${this.info!.macroSpace}.`,
      );
    const s = this.s();
    await s.transfer(Cmd.SET_MACRO, index, { lastFlag: false });
    if (data.length) await s.transfer(Cmd.SET_MACRO, data, { offset: MACRO_INDEX_BYTES });
    const back = await this.readMacroStorage();
    const view = new DataView(index.buffer);
    const missed: number[] = [];
    for (let i = 0; i < MACRO_SLOTS; i++) {
      const addr = view.getUint32(i * 4, true);
      const got = back.blocks.get(i);
      if (!addr) {
        if (got) missed.push(i);
        continue;
      }
      const at = addr - MACRO_INDEX_BYTES;
      const want = data.subarray(at, at + (got?.length ?? 0));
      if (!got || got.length < 4 || want.length !== got.length || want.some((b, j) => b !== got[j]))
        missed.push(i);
    }
    if (missed.length)
      throw new ReadbackMismatchError(`The keyboard did not keep ${missed.length} macro(s).`, {
        macros: missed.map((i) => i + 1),
      });
  }

  private tableCmd(layer: LayerId, write: boolean): number {
    if (layer === 'base') return write ? Cmd.SET_KEY : Cmd.GET_KEY;
    if (layer === 'fn') return write ? Cmd.SET_FN_KEY : Cmd.GET_FN_KEY;
    throw new ProtocolError(`Layer ${layer} does not exist on this keyboard.`);
  }

  override async getKeymap(layer: LayerId = 'base'): Promise<KeymapState> {
    this.requireKeymap();
    const t = await this.s().read(this.tableCmd(layer, false), KEY_TABLE_BYTES);
    const slots: Record<number, ReturnType<typeof decodeKey>> = {};
    for (const k of this.getLayout().keys)
      if (k.slot >= 0) slots[k.slot] = decodeKey(t.subarray(k.slot * 4, k.slot * 4 + 4));
    return { layer, slots, provenance: 'device' };
  }

  override async getFnLayer(): Promise<KeymapState> {
    return this.getKeymap('fn');
  }

  override async setFnLayer(state: KeymapState): Promise<void> {
    await this.setKeymap({ ...state, layer: 'fn' });
  }

  /** Reads the layer's table, changes the given keys, writes it whole and reads it again. */
  override async setKeymap(state: KeymapState): Promise<void> {
    this.requireKeymap();
    const fnSlot = this.model.keys!['Fn'];
    const before = await this.s().read(this.tableCmd(state.layer, false), KEY_TABLE_BYTES);
    const next = before.slice();
    const changed: number[] = [];
    for (const [k, action] of Object.entries(state.slots)) {
      const slot = Number(k);
      if (!Number.isInteger(slot) || slot < 0 || slot * 4 + 4 > next.length)
        throw new ProtocolError(`Key ${k} is outside the key table.`);
      const value = encodeKey(action);
      if (value.every((b, i) => b === before[slot * 4 + i])) continue;
      if (slot === fnSlot) throw new ProtocolError('The Fn key keeps its function.');
      next.set(value, slot * 4);
      changed.push(slot);
    }
    if (!changed.length) return;
    await this.s().transfer(this.tableCmd(state.layer, true), next);
    const back = await this.s().read(this.tableCmd(state.layer, false), KEY_TABLE_BYTES);
    const missed = changed.filter((slot) =>
      back.subarray(slot * 4, slot * 4 + 4).some((b, i) => b !== next[slot * 4 + i]),
    );
    if (missed.length)
      throw new ReadbackMismatchError(`The keyboard did not keep ${missed.length} key(s).`, {
        keys: missed,
      });
  }

  /** Every key of the layer back to its factory function (entry 0); the keyboard keeps its own defaults. */
  override async restoreDefaults(
    scope: 'keymap' | 'fnLayer' | 'macros' | 'lighting',
  ): Promise<void> {
    if (scope === 'macros' && this.macrosOk) return this.setMacros([]);
    if (scope !== 'keymap' && scope !== 'fnLayer') return super.restoreDefaults(scope);
    this.requireKeymap();
    const layer: LayerId = scope === 'keymap' ? 'base' : 'fn';
    const slots: Record<number, { kind: 'default' }> = {};
    for (const k of this.getLayout().keys) if (k.slot >= 0) slots[k.slot] = { kind: 'default' };
    await this.setKeymap({ layer, slots, provenance: 'mirror' });
  }
}

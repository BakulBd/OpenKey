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
  mouseProblems,
} from '@openkey/core';
import type {
  Capabilities,
  DeviceInfo,
  EffectCatalog,
  KeyActionKind,
  KeyboardLayout,
  KeymapState,
  LayerId,
  Macro,
  MacroLimits,
  MouseDriver,
  MouseSchema,
  MouseSettings,
  RgbConfig,
  StateStore,
  TransportMode,
} from '@openkey/core';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import {
  AJ179_PROTOCOL_ID,
  Cmd,
  DEBOUNCE_MS,
  DPI_LEVELS,
  Light,
  REPORT_LEN,
  SLEEP_STEPS,
  Status,
  decodeDpi,
  decodeInfo,
  decodeLighting,
  decodePower,
  decodeSensor,
  dpiRange,
  encodeDpi,
  encodeLighting,
  encodePower,
  encodeSensor,
  frame,
  lightingBytes,
  rateFlag,
  rateHz,
  ratesFor,
} from './codec.js';
import type { Aj179Info } from './codec.js';
import {
  LOCKED_BUTTON,
  MACRO_LIMITS,
  SPECIAL,
  buttonEntry,
  buttonPacket,
  macroPackets,
  mouseLayout,
} from './buttons.js';

/** Replies through the receiver can take 1.5 s while the mouse wakes; the source waits 3 s. */
const REPLY_MS = { usb: 1000, wireless: 3000 } as const;

/** One request at a time; the reply is the next input report that echoes the command. */
export class Aj179Session {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly transport: HidTransport,
    private readonly replyMs: number,
  ) {}

  request(report: Uint8Array): Promise<Uint8Array> {
    const run = async () => {
      this.transport.drainInput();
      await this.transport.sendOutputReport(0, report);
      const deadline = Date.now() + this.replyMs;
      for (;;) {
        const r = await this.transport.readInputReport(Math.max(1, deadline - Date.now()));
        if (!r) throw new TimeoutError('The mouse did not answer.');
        // Status frames from the receiver (c0 …) and other unsolicited reports are skipped.
        if (r.length >= REPORT_LEN && r[0] === report[0]) {
          if (r[1] === Status.ASLEEP)
            throw new ProtocolError('The mouse is asleep or out of range: move it and try again.');
          if (r[1] === Status.NO_ANSWER)
            throw new TimeoutError(
              'The receiver could not reach the mouse: move it and try again.',
            );
          if (r[1] !== Status.OK)
            throw new ProtocolError(`The mouse refused the command (status ${r[1]}).`);
          return r;
        }
        if (Date.now() >= deadline) throw new TimeoutError('The mouse did not answer.');
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  read(cmd: number): Promise<Uint8Array> {
    return this.request(frame(cmd));
  }
}

type FlagId = 'wakeOnMove' | 'lightsOffOnMove' | 'motionSync' | 'angleSnap';

/**
 * AJAZZ AJ179: report rate, six DPI stages, lift-off distance, Motion Sync and Angle Snap, sleep,
 * wake-on-move, debounce and lighting, each read from the mouse, written, and read back. Cable and
 * receiver share one set of settings.
 */
export class Aj179MouseDriver extends BaseKeyboardDriver implements MouseDriver {
  readonly protocolId = AJ179_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: Aj179Session | null = null;
  info: Aj179Info | null = null;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    private readonly open: (i: HidInterfaceInfo) => Promise<HidTransport>,
    private readonly store: StateStore,
  ) {
    super();
    this.transport = group.transportHint;
  }

  /** Mirror keys: the mouse cannot report its buttons or macros. */
  private get key(): string {
    const id = this.group.identity;
    return `aj179/${id.vendorId.toString(16)}-${id.productId.toString(16)}`;
  }

  private s(): Aj179Session {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  async connect(): Promise<void> {
    const ms = this.transport === 'usb' ? REPLY_MS.usb : REPLY_MS.wireless;
    this.session = new Aj179Session(await this.open(this.iface), ms);
    this.info = decodeInfo(await this.session.read(Cmd.INFO));
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.transport.close().catch(() => undefined);
  }

  private sensor(): number {
    return this.info?.sensor ?? 0x95;
  }

  /** Sends a write, then reads `readCmd` back and compares the first `n` payload bytes. */
  private async apply(req: Uint8Array, readCmd: number, n: number): Promise<void> {
    await this.s().request(req);
    const back = await this.s().read(readCmd);
    for (let i = 4; i < 4 + n; i++)
      if (back[i] !== req[i])
        throw new ReadbackMismatchError(
          `The mouse did not keep the change (byte ${i - 4}: wrote ${req[i]}, read ${back[i]}).`,
        );
  }

  getMouseSchema(): MouseSchema {
    const { min, max } = dpiRange(this.sensor());
    return {
      pollingRates: ratesFor(this.info?.rateCaps ?? 0),
      dpi: { min, max, step: min >= 100 ? 100 : 50, levels: DPI_LEVELS },
      debounceMs: { ...DEBOUNCE_MS },
      sleep: SLEEP_STEPS.map((o) => ({ ...o })),
      flags: [
        { id: 'wakeOnMove', label: 'Wake on movement' },
        { id: 'lightsOffOnMove', label: 'Lights off while moving' },
        { id: 'motionSync', label: 'Motion Sync' },
        { id: 'angleSnap', label: 'Angle snapping' },
      ],
      liftOff: [
        { value: 1, label: '1 mm' },
        { value: 2, label: '2 mm' },
      ],
      perLink: false,
    };
  }

  async getMouseSettings(): Promise<MouseSettings> {
    const s = this.s();
    const rate = await s.read(Cmd.GET_RATE);
    const dpi = decodeDpi(await s.read(Cmd.GET_DPI), this.sensor());
    const sensor = decodeSensor(await s.read(Cmd.GET_SENSOR));
    const power = decodePower(await s.read(Cmd.GET_POWER));
    return {
      pollingRate: rateHz(rate[4]!) ?? 0,
      dpi: dpi.dpi,
      dpiCount: dpi.count,
      dpiIndex: dpi.index,
      debounceMs: power.debounceMs,
      sleep: power.sleep,
      liftOff: sensor.liftOff,
      flags: {
        wakeOnMove: power.wakeOnMove,
        lightsOffOnMove: power.lightsOffOnMove,
        motionSync: sensor.motionSync,
        angleSnap: sensor.angleSnap,
      },
    };
  }

  async setMouseSettings(patch: Partial<MouseSettings>): Promise<void> {
    const cur = await this.getMouseSettings();
    const next: MouseSettings = { ...cur, ...patch, flags: { ...cur.flags, ...patch.flags } };
    const problems = mouseProblems(next, this.getMouseSchema());
    if (problems.length) throw new ProtocolError(problems.join(' '));
    const has = (...k: (keyof MouseSettings)[]) => k.some((x) => patch[x] !== undefined);
    const flag = (...ids: FlagId[]) => ids.some((id) => patch.flags?.[id] !== undefined);

    if (has('pollingRate'))
      await this.apply(frame(Cmd.SET_RATE, [rateFlag(next.pollingRate)!]), Cmd.GET_RATE, 1);
    if (has('dpi', 'dpiCount', 'dpiIndex'))
      await this.apply(
        encodeDpi(this.sensor(), { index: next.dpiIndex, count: next.dpiCount, dpi: next.dpi }),
        Cmd.GET_DPI,
        25,
      );
    if (has('liftOff') || flag('motionSync', 'angleSnap'))
      await this.apply(
        encodeSensor({
          liftOff: next.liftOff ?? 2,
          motionSync: !!next.flags.motionSync,
          angleSnap: !!next.flags.angleSnap,
        }),
        Cmd.GET_SENSOR,
        3,
      );
    if (has('sleep', 'debounceMs') || flag('wakeOnMove', 'lightsOffOnMove'))
      await this.apply(
        encodePower({
          sleep: next.sleep,
          wakeOnMove: !!next.flags.wakeOnMove,
          lightsOffOnMove: !!next.flags.lightsOffOnMove,
          debounceMs: next.debounceMs,
        }),
        Cmd.GET_POWER,
        4,
      );
  }

  override async getPollingRate(): Promise<number> {
    return (await this.getMouseSettings()).pollingRate;
  }

  override async setPollingRate(hz: number): Promise<void> {
    await this.setMouseSettings({ pollingRate: hz });
  }

  override async getBattery(): Promise<{ level: number; charging: boolean } | null> {
    const i = decodeInfo(await this.s().read(Cmd.INFO));
    this.info = i;
    return i.battery <= 100 ? { level: i.battery, charging: i.charging } : null;
  }

  override getRgbEffects(): EffectCatalog {
    const c = (color: boolean, speed: boolean) => ({
      color,
      colorful: false,
      brightness: true,
      speed,
      direction: [],
    });
    return {
      effects: [
        { id: Light.CONSTANT, name: 'Constant', controls: c(true, false) },
        { id: Light.BREATHING, name: 'Breathing', controls: c(false, true) },
        { id: Light.NEON, name: 'Neon (rainbow)', controls: c(false, true) },
        { id: Light.OFF, name: 'Off', controls: { ...c(false, false), brightness: false } },
      ],
      brightness: { min: 0, max: 4 },
      speed: { min: 0, max: 4 },
      offEffect: Light.OFF,
    };
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    const l = decodeLighting(await this.s().read(Cmd.GET_LIGHTING));
    return {
      effect: l.mode,
      color: l.color,
      colorful: l.mode === Light.NEON,
      brightness: l.brightness,
      speed: l.speed,
      direction: 'right',
    };
  }

  override async setRgbConfig(c: RgbConfig): Promise<void> {
    const req = encodeLighting({
      mode: c.effect,
      brightness: c.brightness,
      speed: c.speed,
      color: c.color,
    });
    const cur = decodeLighting(await this.s().read(Cmd.GET_LIGHTING));
    // A write that changes the mode only switches to it (the mouse restores that mode's saved
    // levels); the same write sent again applies the new values.
    if (cur.mode !== c.effect) await this.s().request(req);
    await this.apply(req, Cmd.GET_LIGHTING, lightingBytes(c.effect));
  }

  getLayout(): KeyboardLayout {
    return mouseLayout();
  }

  override getLayerIds(): readonly LayerId[] {
    return ['base'];
  }

  override getLayerLabel(layer: LayerId): string | undefined {
    return layer === 'base' ? 'Buttons' : undefined;
  }

  override getKeyActionKinds(): readonly KeyActionKind[] {
    return ['default', 'mouse', 'keyboard', 'consumer', 'special', 'macro'];
  }

  override getSpecialActions(): readonly { code: number; label: string }[] {
    return SPECIAL;
  }

  override async getKeymap(layer: LayerId = 'base'): Promise<KeymapState> {
    if (layer !== 'base') return super.getKeymap(layer);
    return (
      (await this.store.get<KeymapState>(`${this.key}/buttons`)) ?? {
        layer: 'base',
        slots: {},
        provenance: 'assumed-default',
      }
    );
  }

  /**
   * Writes the macros the buttons use (each into its button's slot, as the mouse plays them), then
   * the button table. Every entry is encoded first, so nothing is sent if one cannot be.
   */
  override async setKeymap(state: KeymapState): Promise<void> {
    if (state.layer !== 'base') throw new ProtocolError('The AJ179 has one button layer.');
    const slots = { ...state.slots };
    delete slots[LOCKED_BUTTON];
    const table = buttonPacket(slots);
    const macros = await this.getMacros();
    const uploads: Uint8Array[] = [];
    for (const [b, a] of Object.entries(slots)) {
      buttonEntry(Number(b), a);
      if (a.kind !== 'macro') continue;
      const m = macros.find((x) => x.index === a.index);
      if (!m) throw new ProtocolError(`Macro ${a.index + 1} is empty: record it first.`);
      uploads.push(...macroPackets(Number(b), m));
    }
    for (const p of uploads) await this.s().request(p);
    await this.s().request(table);
    await this.store.set(`${this.key}/buttons`, {
      layer: 'base',
      slots,
      provenance: 'mirror',
      updatedAt: new Date().toISOString(),
    } satisfies KeymapState);
  }

  override async restoreDefaults(
    scope: 'keymap' | 'fnLayer' | 'macros' | 'lighting',
  ): Promise<void> {
    if (scope !== 'keymap') return super.restoreDefaults(scope);
    await this.setKeymap({ layer: 'base', slots: {}, provenance: 'mirror' });
  }

  override getMacroLimits(): MacroLimits {
    return MACRO_LIMITS;
  }

  override async getMacros(): Promise<Macro[]> {
    return (await this.store.get<Macro[]>(`${this.key}/macros`)) ?? [];
  }

  /** Stores the macros and writes them again to every button that plays one. */
  override async setMacros(macros: Macro[]): Promise<void> {
    const { slots } = await this.getKeymap('base');
    const uploads: Uint8Array[] = [];
    for (const [b, a] of Object.entries(slots)) {
      if (a.kind !== 'macro') continue;
      const m = macros.find((x) => x.index === a.index);
      if (m) uploads.push(...macroPackets(Number(b), m));
    }
    for (const p of uploads) await this.s().request(p);
    await this.store.set(`${this.key}/macros`, macros);
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const S = Evidence.OBSERVED;
    const src =
      'Rockeyxx/aj179-linux PROTOCOL.md (vendor driver, checked on the mouse by the source)';
    const persist = { safety: SafetyLevel.SAFE_PERSISTENT, source: src };
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: S,
      source: 'info (0x10)',
    });
    c.debounce = configurable('device', true, S, { ...persist, value: '0–20 ms' });
    c.pollingRate = configurable('device', true, S, {
      ...persist,
      value: `${ratesFor(this.info?.rateCaps ?? 0).join(', ')} Hz`,
    });
    c.sleep = configurable('device', true, S, persist);
    c.rgb = configurable('device', true, S, {
      ...persist,
      note: 'Constant, breathing, neon and off; read from the mouse and read back.',
    });
    c.battery = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: S,
      source: 'info (0x10)',
    });
    const mirror = {
      safety: SafetyLevel.CAUTION,
      source:
        'Rockeyxx/aj179-linux PROTOCOL.md: button table 0x09 and macro upload 0x08 (vendor driver; checked on the mouse by the source)',
    };
    c.keymap = configurable('mirror', true, S, {
      ...mirror,
      value:
        'right, middle, back, forward and DPI buttons: mouse buttons, wheel, DPI, keys, media keys, macros',
      note: 'The mouse cannot report its buttons; OpenKey shows what it last wrote. The left button stays a left click, so you can always undo. Restore defaults writes the factory table.',
    });
    c.macros = configurable('mirror', true, S, {
      ...mirror,
      value: `up to ${MACRO_LIMITS.slots} macros (one per button)`,
      note: 'A macro is stored in the slot of the button that plays it; assign it to a button on the Buttons page.',
    });
    c.factoryDefaults = configurable('none', true, S, {
      ...mirror,
      note: 'Writes the vendor’s factory button table; the other settings stay as they are.',
    });
    for (const f of ['fnLayer', 'perKeyRgb', 'tft', 'tftGif'] as const)
      c[f] = feature(FeatureStatus.NOT_SUPPORTED, {
        confidence: S,
        note: 'A mouse; these are keyboard features.',
      });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const id = this.group.identity;
    const i = this.info;
    return {
      model: 'AJAZZ AJ179',
      profileId: `aj179-${id.vendorId.toString(16)}-${id.productId.toString(16)}`,
      identity: id,
      firmware: {
        version: i?.firmware ?? null,
        source: i?.firmware
          ? 'info bytes 8–9 (meaning inferred by the source)'
          : 'not reported through the receiver',
        confidence: Evidence.INFERRED,
      },
      transport: this.transport,
      protocol: { id: this.protocolId, name: 'AJAZZ Driver (X) mouse protocol' },
      battery: i ? { level: i.battery, charging: i.charging } : null,
      fields: i
        ? [
            {
              key: 'id',
              label: 'Device id',
              value: i.id,
              confidence: Evidence.VERIFIED,
              source: 'info (0x10)',
            },
            {
              key: 'sensor',
              label: 'Sensor',
              value: i.sensor === 0x95 ? 'PAW3395' : `0x${i.sensor.toString(16)}`,
              confidence: Evidence.OBSERVED,
              source: 'info byte 10',
            },
            {
              key: 'link',
              label: 'Settings',
              value: 'shared by the cable and the receiver',
              confidence: Evidence.OBSERVED,
              source: 'PROTOCOL.md (checked on hardware)',
            },
          ]
        : [],
    };
  }
}

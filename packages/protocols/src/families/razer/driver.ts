import {
  BaseKeyboardDriver,
  Evidence,
  FeatureStatus,
  ProtocolError,
  ReadbackMismatchError,
  SafetyLevel,
  TimeoutError,
  UnsupportedFeatureError,
  configurable,
  emptyCapabilities,
  feature,
  sleep as realSleep,
} from '@openkey/core';
import type {
  Capabilities,
  DeviceInfo,
  EffectCatalog,
  KeyboardLayout,
  PerKeyRgb,
  Rgb,
  RgbConfig,
  StateStore,
  TransportMode,
} from '@openkey/core';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import { RAZER_PROTOCOL_ID, REPORT_BYTES } from './models.js';
import type { RazerModel } from './models.js';

export const Status = { NEW: 0, BUSY: 1, OK: 2, FAILED: 3, TIMEOUT: 4, UNSUPPORTED: 5 } as const;
/** Store the setting in the keyboard (Synapse's choice) or only show it until unplugged. */
const VARSTORE = 0x01;
const NOSTORE = 0x00;
const BACKLIGHT = 0x05;

export interface RazerCommand {
  cls: number;
  id: number;
  args: number[];
  /** Data size field; defaults to the argument count. */
  size?: number;
}

export function encode(tid: number, c: RazerCommand): Uint8Array {
  if (c.args.length > 80) throw new ProtocolError('Razer arguments are at most 80 bytes');
  const r = new Uint8Array(REPORT_BYTES);
  r[1] = tid;
  r[5] = c.size ?? c.args.length;
  r[6] = c.cls;
  r[7] = c.id;
  r.set(c.args, 8);
  r[88] = crc(r);
  return r;
}

export function crc(r: Uint8Array): number {
  let x = 0;
  for (let i = 2; i < 88; i++) x ^= r[i]!;
  return x;
}

export const firmwareCmd: RazerCommand = { cls: 0x00, id: 0x81, args: [0, 0] };

export const brightnessGet = (set: 'std' | 'ext'): RazerCommand =>
  set === 'ext'
    ? { cls: 0x0f, id: 0x84, args: [VARSTORE, BACKLIGHT, 0] }
    : { cls: 0x03, id: 0x83, args: [VARSTORE, BACKLIGHT, 0] };

export const brightnessSet = (set: 'std' | 'ext', v: number): RazerCommand =>
  set === 'ext'
    ? { cls: 0x0f, id: 0x04, args: [VARSTORE, BACKLIGHT, v] }
    : { cls: 0x03, id: 0x03, args: [VARSTORE, BACKLIGHT, v] };

/** OpenKey's effect ids for Razer keyboards. */
export const Effect = {
  OFF: 0,
  STATIC: 1,
  BREATHING: 2,
  SPECTRUM: 3,
  WAVE: 4,
  REACTIVE: 5,
  STARLIGHT: 6,
  CUSTOM: 7,
} as const;

/** The effect command for a lighting setting, in the model's command set. */
export function effectCmd(set: 'std' | 'ext', c: RgbConfig): RazerCommand {
  const { r, g, b } = c.color;
  const speed = Math.max(1, Math.min(3, Math.round(c.speed)));
  const dir = c.direction === 'left' ? 2 : 1;
  if (set === 'ext') {
    const base = (effect: number, rest: number[] = []) => ({
      cls: 0x0f,
      id: 0x02,
      args: [VARSTORE, BACKLIGHT, effect, ...rest],
    });
    switch (c.effect) {
      case Effect.OFF:
        return { ...base(0x00, [0, 0, 0]) };
      case Effect.STATIC:
        return base(0x01, [0, 0, 1, r, g, b]);
      case Effect.BREATHING:
        return c.colorful ? base(0x02, [0, 0, 0]) : base(0x02, [1, 0, 1, r, g, b]);
      case Effect.SPECTRUM:
        return base(0x03, [0, 0, 0]);
      case Effect.WAVE:
        return base(0x04, [dir, 0x28, 0]);
      case Effect.REACTIVE:
        return base(0x05, [0, speed, 1, r, g, b]);
      case Effect.STARLIGHT:
        return c.colorful ? base(0x07, [0, speed, 0]) : base(0x07, [1, speed, 1, r, g, b]);
      case Effect.CUSTOM:
        return { cls: 0x0f, id: 0x02, args: [NOSTORE, 0x00, 0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    }
  } else {
    switch (c.effect) {
      case Effect.OFF:
        return { cls: 0x03, id: 0x0a, args: [0x00] };
      case Effect.STATIC:
        return { cls: 0x03, id: 0x0a, args: [0x06, r, g, b] };
      case Effect.BREATHING:
        return c.colorful
          ? { cls: 0x03, id: 0x0a, args: [0x03, 0x03, 0, 0, 0, 0, 0, 0] }
          : { cls: 0x03, id: 0x0a, args: [0x03, 0x01, r, g, b, 0, 0, 0] };
      case Effect.SPECTRUM:
        return { cls: 0x03, id: 0x0a, args: [0x04] };
      case Effect.WAVE:
        return { cls: 0x03, id: 0x0a, args: [0x01, dir] };
      case Effect.REACTIVE:
        return { cls: 0x03, id: 0x0a, args: [0x02, speed, r, g, b] };
      case Effect.CUSTOM:
        return { cls: 0x03, id: 0x0a, args: [0x05, NOSTORE] };
    }
  }
  throw new ProtocolError(`Effect ${c.effect} is not offered for this keyboard.`);
}

/** One row of the custom frame (columns start..stop inclusive). */
export function frameRowCmd(set: 'std' | 'ext', row: number, colors: readonly Rgb[]): RazerCommand {
  const rgb = colors.flatMap((c) => [c.r, c.g, c.b]);
  const stop = colors.length - 1;
  return set === 'ext'
    ? { cls: 0x0f, id: 0x03, args: [0, 0, row, 0, stop, ...rgb] }
    : { cls: 0x03, id: 0x0b, args: [0xff, row, 0, stop, ...rgb] };
}

/**
 * One command at a time: SET the report, then GET answers until the keyboard reports this command
 * as done. Busy answers and answers to other software's commands are read past; a lost command is
 * sent again (up to three times), as OpenRGB does.
 */
export class RazerSession {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly transport: HidTransport,
    private readonly tid: number,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {}

  run(c: RazerCommand): Promise<Uint8Array> {
    const go = async () => {
      const req = encode(this.tid, c);
      for (let send = 0; send < 3; send++) {
        await this.transport.sendFeatureReport(0, req);
        for (let read = 0; read < 25; read++) {
          await this.sleep(2);
          const r = await this.transport.receiveFeatureReport(0, REPORT_BYTES);
          if (r.length < REPORT_BYTES || r[6] !== c.cls || r[7] !== c.id) continue;
          if (r[0] === Status.BUSY || r[0] === Status.NEW) continue;
          if (r[0] === Status.OK) return r;
          if (r[0] === Status.UNSUPPORTED)
            throw new UnsupportedFeatureError('rgb', 'the keyboard does not support this command');
          if (r[0] === Status.TIMEOUT)
            throw new TimeoutError('The keyboard timed out on the command.');
          throw new ProtocolError(`The keyboard refused the command (status ${r[0]}).`);
        }
      }
      throw new TimeoutError('The keyboard did not answer.');
    };
    const p = this.queue.then(go, go);
    this.queue = p.catch(() => undefined);
    return p;
  }
}

interface Mirror {
  rgb: RgbConfig;
  perKey: PerKeyRgb;
}

/**
 * Razer Chroma keyboards: built-in effects and brightness, stored in the keyboard; per-LED colours of
 * the keyboard's LED matrix, shown until the next effect or unplug. Brightness is read back.
 */
export class RazerDriver extends BaseKeyboardDriver {
  readonly protocolId = RAZER_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: RazerSession | null = null;
  firmware: string | null = null;

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    readonly model: RazerModel,
    private readonly opts: {
      store: StateStore;
      open: (i: HidInterfaceInfo) => Promise<HidTransport>;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    super();
    this.transport = group.transportHint;
  }

  private get key(): string {
    return `razer/${this.model.productId.toString(16)}`;
  }

  private s(): RazerSession {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  async connect(): Promise<void> {
    this.session = new RazerSession(
      await this.opts.open(this.iface),
      this.model.transactionId,
      this.opts.sleep,
    );
    const r = await this.session.run(firmwareCmd);
    this.firmware = `${r[8]}.${r[9]}`;
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.transport.close().catch(() => undefined);
  }

  /** The keyboard's LED matrix as a grid: Razer numbers LEDs by row and column. */
  getLayout(): KeyboardLayout {
    const { rows, cols } = this.model;
    const keys = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        keys.push({
          id: `r${r}c${c}`,
          label: `${r + 1}·${c + 1}`,
          slot: r * cols + c,
          light: r * cols + c,
          usage: 0,
          x: c,
          y: r,
          w: 1,
          h: 1,
        });
    return {
      id: `razer-${this.model.productId.toString(16)}`,
      name: `${this.model.name}: LED matrix (${rows} rows × ${cols} columns)`,
      width: cols,
      height: rows,
      keys,
      source:
        'LED matrix size from OpenRGB’s Razer table. Positions are matrix cells (row · column), not key labels; some cells have no LED.',
    };
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const ev = Evidence.INFERRED;
    const src = 'openrazer and OpenRGB (facts only), used daily on this model by their users';
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: Evidence.OBSERVED,
      source: 'firmware version (00 81)',
    });
    c.rgb = configurable('mirror', true, ev, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: src,
      value: 'built-in effects and brightness 0–255',
      note: 'The effect is stored in the keyboard but cannot be read back; brightness is read back after every change.',
    });
    c.perKeyRgb = configurable('mirror', true, ev, {
      safety: SafetyLevel.SAFE_VOLATILE,
      source: src,
      value: `${this.model.rows * this.model.cols} matrix cells`,
      note: 'Shown until another effect is chosen or the keyboard is unplugged (custom frame).',
    });
    for (const f of ['keymap', 'macros'] as const)
      c[f] = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED, {
        confidence: Evidence.INFERRED,
        note: 'Razer key maps and macros live in Synapse’s on-board profiles; their protocol is not public.',
      });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      model: this.model.name,
      profileId: this.key.replace('/', '-'),
      identity: this.group.identity,
      firmware: {
        version: this.firmware,
        source: 'firmware version (00 81)',
        confidence: Evidence.OBSERVED,
      },
      transport: this.transport,
      protocol: {
        id: this.protocolId,
        name: 'Razer Chroma (90-byte feature reports)',
        revision:
          this.model.set === 'ext' ? 'extended matrix commands' : 'standard matrix commands',
      },
      battery: null,
      fields: [],
    };
  }

  override getRgbEffects(): EffectCatalog {
    const ctl = (
      color: boolean,
      colorful: boolean,
      speed: boolean,
      direction: ('left' | 'right')[] = [],
    ) => ({
      color,
      colorful,
      brightness: true,
      speed,
      direction,
    });
    const effects = [
      { id: Effect.STATIC, name: 'Static', controls: ctl(true, false, false) },
      { id: Effect.BREATHING, name: 'Breathing', controls: ctl(true, true, false) },
      { id: Effect.SPECTRUM, name: 'Spectrum cycle', controls: ctl(false, false, false) },
      { id: Effect.WAVE, name: 'Wave', controls: ctl(false, false, false, ['left', 'right']) },
      { id: Effect.REACTIVE, name: 'Reactive', controls: ctl(true, false, true) },
      ...(this.model.set === 'ext'
        ? [{ id: Effect.STARLIGHT, name: 'Starlight', controls: ctl(true, true, true) }]
        : []),
      { id: Effect.CUSTOM, name: 'Per-key colours', controls: ctl(false, false, false) },
      { id: Effect.OFF, name: 'Off', controls: { ...ctl(false, false, false), brightness: false } },
    ];
    return {
      effects,
      brightness: { min: 0, max: 255 },
      speed: { min: 1, max: 3 },
      offEffect: Effect.OFF,
      customEffect: Effect.CUSTOM,
    };
  }

  private async mirror(): Promise<Mirror> {
    return (
      (await this.opts.store.get<Mirror>(this.key)) ?? {
        rgb: {
          effect: Effect.SPECTRUM,
          color: { r: 0, g: 255, b: 0 },
          colorful: false,
          brightness: 255,
          speed: 2,
          direction: 'right',
        },
        perKey: {},
      }
    );
  }

  private async brightness(): Promise<number> {
    const r = await this.s().run(brightnessGet(this.model.set));
    return r[10]!;
  }

  override async getRgbConfig(): Promise<RgbConfig> {
    const m = await this.mirror();
    return { ...m.rgb, brightness: await this.brightness() };
  }

  override async setRgbConfig(c: RgbConfig): Promise<void> {
    if (!this.getRgbEffects().effects.some((e) => e.id === c.effect))
      throw new ProtocolError(`Effect ${c.effect} is not offered for this keyboard.`);
    const b = Math.max(0, Math.min(255, Math.round(c.brightness)));
    const m = await this.mirror();
    if (c.effect === Effect.CUSTOM) await this.sendFrame(m.perKey);
    else await this.s().run(effectCmd(this.model.set, c));
    await this.s().run(brightnessSet(this.model.set, b));
    const back = await this.brightness();
    if (back !== b)
      throw new ReadbackMismatchError(`The keyboard kept brightness ${back}, not ${b}.`);
    await this.opts.store.set(this.key, { ...m, rgb: { ...c, brightness: b } });
  }

  override async getPerKeyRgb(): Promise<PerKeyRgb> {
    return (await this.mirror()).perKey;
  }

  override async setPerKeyRgb(colors: PerKeyRgb): Promise<void> {
    await this.sendFrame(colors);
    const m = await this.mirror();
    await this.opts.store.set(this.key, {
      perKey: colors,
      rgb: { ...m.rgb, effect: Effect.CUSTOM },
    });
  }

  private async sendFrame(colors: PerKeyRgb): Promise<void> {
    const { rows, cols, set } = this.model;
    for (let r = 0; r < rows; r++) {
      const row = Array.from(
        { length: cols },
        (_, c) => colors[r * cols + c] ?? { r: 0, g: 0, b: 0 },
      );
      await this.s().run(frameRowCmd(set, r, row));
    }
    await this.s().run(effectCmd(set, { ...(await this.mirror()).rgb, effect: Effect.CUSTOM }));
  }
}

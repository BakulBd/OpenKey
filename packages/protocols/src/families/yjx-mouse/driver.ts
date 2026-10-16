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
import type { Capabilities, DeviceInfo, KeyboardLayout, TransportMode } from '@openkey/core';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import {
  READ_BATTERY,
  READ_CONFIG,
  READ_INFO,
  REPORT_SIZE,
  YJX_PROTOCOL_ID,
  answers,
  decodeConfig,
  encodeWrite,
} from './codec.js';
import type { YjxMouseConfig } from './codec.js';

const REPLY_MS = 1500;

/** One request at a time; every reply must answer its request. */
export class YjxSession {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly transport: HidTransport) {}

  request(bytes: readonly number[] | Uint8Array): Promise<Uint8Array> {
    const run = async () => {
      const report = new Uint8Array(REPORT_SIZE);
      report.set(Array.from(bytes).slice(0, REPORT_SIZE));
      this.transport.drainInput();
      await this.transport.sendOutputReport(0, report);
      const deadline = Date.now() + REPLY_MS;
      // The mouse may push unsolicited reports (the DPI button over the receiver): skip them.
      for (;;) {
        const r = await this.transport.readInputReport(Math.max(1, deadline - Date.now()));
        if (!r) throw new TimeoutError('The mouse did not answer.');
        if (answers(r, [...report])) return r;
        if (Date.now() >= deadline) throw new TimeoutError('The mouse did not answer.');
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}

/**
 * AJAZZ AJ139 V2 MC: debounce, polling rate, DPI levels, sleep, wake-up and scroll direction, read
 * from the mouse and written as read-modify-write of the settings block, then read back. Cable and
 * receiver keep separate settings (per the source), so the link in use is the one changed.
 */
export class YjxMouseDriver extends BaseKeyboardDriver {
  readonly protocolId = YJX_PROTOCOL_ID;
  readonly transport: TransportMode;
  private session: YjxSession | null = null;
  info = '';

  constructor(
    private readonly group: HidDeviceGroup,
    private readonly iface: HidInterfaceInfo,
    private readonly open: (i: HidInterfaceInfo) => Promise<HidTransport>,
  ) {
    super();
    this.transport = group.transportHint;
  }

  private s(): YjxSession {
    if (!this.session) throw new ProtocolError('Not connected');
    return this.session;
  }

  async connect(): Promise<void> {
    this.session = new YjxSession(await this.open(this.iface));
    const r = await this.session.request(READ_INFO).catch(() => null);
    this.info = r
      ? new TextDecoder().decode(r.subarray(8).filter((b) => b >= 0x20 && b < 0x7f))
      : '';
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.transport.close().catch(() => undefined);
  }

  private async readBlock(): Promise<Uint8Array> {
    return this.s().request(READ_CONFIG);
  }

  async getMouseConfig(): Promise<YjxMouseConfig> {
    return decodeConfig(await this.readBlock());
  }

  /** Changes the given fields only: reads the block, replaces them, writes, checks the reply and reads back. */
  async setMouseConfig(patch: Partial<YjxMouseConfig>): Promise<void> {
    const block = await this.readBlock();
    const next = { ...decodeConfig(block), ...patch };
    const reply = await this.s().request(encodeWrite(block, next));
    const echoed = decodeConfig(reply);
    const back = decodeConfig(await this.readBlock());
    for (const c of [echoed, back]) {
      const wrong = (Object.keys(patch) as (keyof YjxMouseConfig)[]).filter(
        (k) => JSON.stringify(c[k]) !== JSON.stringify(next[k]),
      );
      if (wrong.length)
        throw new ReadbackMismatchError(`The mouse did not keep: ${wrong.join(', ')}.`);
    }
  }

  override async getPollingRate(): Promise<number> {
    return (await this.getMouseConfig()).pollingRate;
  }

  override async setPollingRate(hz: number): Promise<void> {
    await this.setMouseConfig({ pollingRate: hz });
  }

  override async getBattery(): Promise<{ level: number; charging: boolean } | null> {
    const r = await this.s()
      .request(READ_BATTERY)
      .catch(() => null);
    const level = r?.[8];
    return level !== undefined && level <= 100 ? { level, charging: false } : null;
  }

  getLayout(): KeyboardLayout {
    return { id: 'mouse', name: 'Mouse', width: 1, height: 1, keys: [], source: 'mouse (no keys)' };
  }

  getCapabilities(): Capabilities {
    const c = emptyCapabilities();
    const S = Evidence.OBSERVED;
    const src =
      'Ripariav/Ajazz-AJ139V2MC-Linux-Driver PROTOCOL.md (captured from the vendor web configurator)';
    c.deviceInfo = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: S,
      source: 'info string (55 03)',
    });
    c.debounce = configurable('device', true, S, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: src,
      value: 'button debounce, 1–20 ms',
      note: 'Read from the mouse; written as part of its settings block and read back.',
    });
    c.pollingRate = configurable('device', true, S, {
      safety: SafetyLevel.SAFE_PERSISTENT,
      source: src,
      value: '125–2000 Hz',
    });
    c.sleep = configurable('device', true, S, { safety: SafetyLevel.SAFE_PERSISTENT, source: src });
    c.battery = feature(FeatureStatus.READ_ONLY, {
      read: 'device',
      confidence: S,
      source: 'battery query (55 30)',
    });
    for (const f of ['keymap', 'fnLayer', 'macros', 'rgb', 'perKeyRgb', 'tft', 'tftGif'] as const)
      c[f] = feature(FeatureStatus.NOT_SUPPORTED, {
        confidence: S,
        note: 'A mouse; these are keyboard features.',
      });
    return c;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const id = this.group.identity;
    return {
      model: 'AJAZZ AJ139 V2 MC',
      profileId: `yjx-mouse-${id.vendorId.toString(16)}-${id.productId.toString(16)}`,
      identity: id,
      firmware: {
        version: this.info || null,
        source: 'info string (55 03)',
        confidence: Evidence.OBSERVED,
      },
      transport: this.transport,
      protocol: {
        id: this.protocolId,
        name: 'AJAZZ mouse (YJX)',
        revision: 'web configurator protocol',
      },
      battery: null,
      fields: [
        {
          key: 'link',
          label: 'Settings',
          value: this.transport === '2.4ghz' ? 'the receiver’s own set' : 'the cable’s own set',
          confidence: Evidence.OBSERVED,
          source: 'PROTOCOL.md: cable and receiver keep separate settings',
        },
      ],
    };
  }
}

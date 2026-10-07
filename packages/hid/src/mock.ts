import { TimeoutError, TransportError } from '@openkey/core';
import type { DeviceIdentity, TransportMode } from '@openkey/core';
import { InputQueue } from './input-queue.js';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from './types.js';
import { interfaceLabel } from './types.js';

export interface MockContext {
  /** Queue an input report on this interface. */
  emitInput(bytes: Uint8Array): void;
  /** Queue an input report on another interface of the same device. */
  emitInputOn(usagePage: number, bytes: Uint8Array): void;
}

/** Scriptable firmware behaviour for one interface. Unhandled operations fail like a stalled endpoint. */
export interface MockBehavior {
  onOutput?(reportId: number, data: Uint8Array, ctx: MockContext): void | Promise<void>;
  onFeatureSet?(reportId: number, data: Uint8Array, ctx: MockContext): void | Promise<void>;
  onFeatureGet?(
    reportId: number,
    length: number,
    ctx: MockContext,
  ): Uint8Array | Promise<Uint8Array>;
}

export interface MockTraffic {
  usagePage: number;
  op: 'output' | 'feature-set' | 'feature-get';
  reportId: number;
  data: Uint8Array;
}

export type MockOp = MockTraffic['op'] | 'input';

/**
 * A fault injected into the next matching operation. Lets tests prove that adapters handle broken
 * firmware answers without real hardware.
 */
export type MockFault =
  /** The operation throws a timeout. For `input`, the next queued input report is dropped. */
  | { kind: 'timeout'; op: MockOp }
  /** The response bytes are replaced (truncation, wrong report ID byte, bad checksum …). */
  | { kind: 'corrupt'; op: 'feature-get' | 'input'; mutate: (bytes: Uint8Array) => Uint8Array }
  /** The device disappears: every later operation throws until `reconnect()`. */
  | { kind: 'disconnect' }
  /** The firmware restarts: state is reset through `onReset`, then the device is back. */
  | { kind: 'reset' };

/** Ready-made corruptions for the `corrupt` fault. */
export const mockCorruptions = {
  truncate: (keep: number) => (b: Uint8Array) => b.slice(0, keep),
  flipByte: (index: number) => (b: Uint8Array) => {
    const c = b.slice();
    const i = index < 0 ? c.length + index : index;
    c[i] = (c[i] ?? 0) ^ 0xff;
    return c;
  },
  prependByte: (value: number) => (b: Uint8Array) => {
    const c = new Uint8Array(b.length + 1);
    c[0] = value;
    c.set(b, 1);
    return c;
  },
  zeros: () => (b: Uint8Array) => new Uint8Array(b.length),
};

export class MockHidTransport implements HidTransport {
  readonly label: string;
  private isOpen = false;
  readonly queue = new InputQueue();

  constructor(
    readonly info: HidInterfaceInfo,
    private readonly behavior: MockBehavior,
    private readonly device: MockHidDevice,
  ) {
    this.label = interfaceLabel(info);
  }

  get opened(): boolean {
    return this.isOpen;
  }
  private get usagePage(): number {
    return this.info.collections[0]?.usagePage ?? 0;
  }
  private ctx(): MockContext {
    return {
      emitInput: (b) => this.queue.push(b),
      emitInputOn: (page, b) => this.device.transportFor(page)?.queue.push(b),
    };
  }
  async open(): Promise<void> {
    this.isOpen = true;
  }
  async close(): Promise<void> {
    this.isOpen = false;
    this.queue.cancelAll();
  }
  private ensureOpen(): void {
    if (!this.device.connected) throw new TransportError(`${this.label}: device disconnected`);
    if (!this.isOpen) throw new TransportError(`${this.label} is not open`);
  }
  /** Applies a pending timeout fault for `op`; returns a pending corruption, if any. */
  private fault(op: MockOp): ((b: Uint8Array) => Uint8Array) | undefined {
    const f = this.device.takeFault(op);
    if (!f) return undefined;
    if (f.kind === 'timeout') throw new TimeoutError(`${this.label}: ${op} timed out (injected)`);
    return f.kind === 'corrupt' ? f.mutate : undefined;
  }
  async sendOutputReport(reportId: number, data: Uint8Array): Promise<void> {
    this.ensureOpen();
    this.fault('output');
    this.device.traffic.push({
      usagePage: this.usagePage,
      op: 'output',
      reportId,
      data: data.slice(),
    });
    if (!this.behavior.onOutput)
      throw new TransportError(`${this.label}: output report not accepted`);
    await this.behavior.onOutput(reportId, data.slice(), this.ctx());
  }
  async sendFeatureReport(reportId: number, data: Uint8Array): Promise<void> {
    this.ensureOpen();
    this.fault('feature-set');
    this.device.traffic.push({
      usagePage: this.usagePage,
      op: 'feature-set',
      reportId,
      data: data.slice(),
    });
    if (!this.behavior.onFeatureSet)
      throw new TransportError(`${this.label}: feature report not accepted`);
    await this.behavior.onFeatureSet(reportId, data.slice(), this.ctx());
  }
  async receiveFeatureReport(reportId: number, length: number): Promise<Uint8Array> {
    this.ensureOpen();
    const mutate = this.fault('feature-get');
    if (!this.behavior.onFeatureGet)
      throw new TransportError(`${this.label}: feature report not readable`);
    const answer = await this.behavior.onFeatureGet(reportId, length, this.ctx());
    const r = mutate ? mutate(answer) : answer;
    this.device.traffic.push({
      usagePage: this.usagePage,
      op: 'feature-get',
      reportId,
      data: r.slice(),
    });
    return r;
  }
  async readInputReport(timeoutMs: number): Promise<Uint8Array | null> {
    if (!this.device.connected) throw new TransportError(`${this.label}: device disconnected`);
    const f = this.device.takeFault('input');
    if (f?.kind === 'timeout') {
      // The report is lost on the wire: drop it and report silence.
      await this.queue.next(0);
      return this.queue.next(timeoutMs);
    }
    const r = await this.queue.next(timeoutMs);
    return r && f?.kind === 'corrupt' ? f.mutate(r) : r;
  }
  drainInput(): void {
    this.queue.clear();
  }
}

export interface MockInterfaceSpec {
  info: HidInterfaceInfo;
  behavior: MockBehavior;
}

export interface MockDeviceOptions {
  /** Called when a `reset` fault fires, so a simulator can restore its power-on state. */
  onReset?(): void;
}

/** A simulated physical device for CI: no hardware required. */
export class MockHidDevice {
  readonly traffic: MockTraffic[] = [];
  private readonly transports = new Map<HidInterfaceInfo, MockHidTransport>();
  private readonly faults: MockFault[] = [];
  private readonly disconnectListeners = new Set<() => void>();
  connected = true;

  constructor(
    readonly identity: DeviceIdentity,
    readonly specs: MockInterfaceSpec[],
    readonly transportHint: TransportMode = 'usb',
    private readonly options: MockDeviceOptions = {},
  ) {
    for (const s of specs)
      this.transports.set(s.info, new MockHidTransport(s.info, s.behavior, this));
  }

  /** Queues a fault for the next matching operation; `disconnect` and `reset` act immediately. */
  inject(fault: MockFault): void {
    if (fault.kind === 'disconnect') return this.disconnect();
    if (fault.kind === 'reset') {
      this.disconnect();
      this.options.onReset?.();
      this.reconnect();
      return;
    }
    this.faults.push(fault);
  }

  /** @internal Removes and returns the first pending fault for `op`. */
  takeFault(op: MockOp): MockFault | undefined {
    const i = this.faults.findIndex((f) => 'op' in f && f.op === op);
    return i < 0 ? undefined : this.faults.splice(i, 1)[0];
  }

  disconnect(): void {
    this.connected = false;
    for (const t of this.transports.values()) void t.close();
    for (const l of this.disconnectListeners) l();
  }

  reconnect(): void {
    this.connected = true;
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  transportFor(usagePage: number): MockHidTransport | undefined {
    for (const [info, t] of this.transports)
      if (info.collections.some((c) => c.usagePage === usagePage)) return t;
    return undefined;
  }

  group(): HidDeviceGroup {
    const transports = this.transports;
    const isConnected = (): boolean => this.connected;
    return {
      key: `${this.identity.vendorId}:${this.identity.productId}:${this.identity.productName}`,
      identity: this.identity,
      interfaces: this.specs.map((s) => s.info),
      backend: 'mock',
      transportHint: this.transportHint,
      async openInterface(iface: HidInterfaceInfo): Promise<HidTransport> {
        const t = transports.get(iface);
        if (!t) throw new TransportError('Unknown mock interface');
        if (!isConnected()) throw new TransportError('Mock device is disconnected');
        await t.open();
        return t;
      },
    };
  }
}

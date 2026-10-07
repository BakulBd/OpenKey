import { TransportError } from '@openkey/core';
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
    if (!this.isOpen) throw new TransportError(`${this.label} is not open`);
  }
  async sendOutputReport(reportId: number, data: Uint8Array): Promise<void> {
    this.ensureOpen();
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
    if (!this.behavior.onFeatureGet)
      throw new TransportError(`${this.label}: feature report not readable`);
    const r = await this.behavior.onFeatureGet(reportId, length, this.ctx());
    this.device.traffic.push({
      usagePage: this.usagePage,
      op: 'feature-get',
      reportId,
      data: r.slice(),
    });
    return r;
  }
  readInputReport(timeoutMs: number): Promise<Uint8Array | null> {
    return this.queue.next(timeoutMs);
  }
  drainInput(): void {
    this.queue.clear();
  }
}

export interface MockInterfaceSpec {
  info: HidInterfaceInfo;
  behavior: MockBehavior;
}

/** A simulated physical device for CI: no hardware required. */
export class MockHidDevice {
  readonly traffic: MockTraffic[] = [];
  private readonly transports = new Map<HidInterfaceInfo, MockHidTransport>();

  constructor(
    readonly identity: DeviceIdentity,
    readonly specs: MockInterfaceSpec[],
    readonly transportHint: TransportMode = 'usb',
  ) {
    for (const s of specs)
      this.transports.set(s.info, new MockHidTransport(s.info, s.behavior, this));
  }

  transportFor(usagePage: number): MockHidTransport | undefined {
    for (const [info, t] of this.transports)
      if (info.collections.some((c) => c.usagePage === usagePage)) return t;
    return undefined;
  }

  group(): HidDeviceGroup {
    const transports = this.transports;
    return {
      key: `${this.identity.vendorId}:${this.identity.productId}:${this.identity.productName}`,
      identity: this.identity,
      interfaces: this.specs.map((s) => s.info),
      backend: 'mock',
      transportHint: this.transportHint,
      async openInterface(iface: HidInterfaceInfo): Promise<HidTransport> {
        const t = transports.get(iface);
        if (!t) throw new TransportError('Unknown mock interface');
        await t.open();
        return t;
      },
    };
  }
}

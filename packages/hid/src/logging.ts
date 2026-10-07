import type { PacketLog } from '@openkey/core';
import type { HidInterfaceInfo, HidTransport } from './types.js';

/** Decorates a transport so every report is recorded in a PacketLog (Diagnostics, captures, debug). */
export class LoggingTransport implements HidTransport {
  constructor(
    private readonly inner: HidTransport,
    private readonly log: PacketLog,
  ) {}

  get info(): HidInterfaceInfo {
    return this.inner.info;
  }
  get label(): string {
    return this.inner.label;
  }
  get opened(): boolean {
    return this.inner.opened;
  }
  private get usagePage(): number {
    return this.inner.info.collections[0]?.usagePage ?? 0;
  }

  open(): Promise<void> {
    return this.inner.open();
  }
  close(): Promise<void> {
    return this.inner.close();
  }

  async sendOutputReport(reportId: number, data: Uint8Array): Promise<void> {
    const t0 = performance.now();
    try {
      await this.inner.sendOutputReport(reportId, data);
      this.record('host->device', 'output', reportId, data, performance.now() - t0);
    } catch (e) {
      this.record('host->device', 'output', reportId, data, performance.now() - t0, e);
      throw e;
    }
  }

  async sendFeatureReport(reportId: number, data: Uint8Array): Promise<void> {
    const t0 = performance.now();
    try {
      await this.inner.sendFeatureReport(reportId, data);
      this.record('host->device', 'feature-set', reportId, data, performance.now() - t0);
    } catch (e) {
      this.record('host->device', 'feature-set', reportId, data, performance.now() - t0, e);
      throw e;
    }
  }

  async receiveFeatureReport(reportId: number, length: number): Promise<Uint8Array> {
    const t0 = performance.now();
    try {
      const r = await this.inner.receiveFeatureReport(reportId, length);
      this.record('device->host', 'feature-get', reportId, r, performance.now() - t0);
      return r;
    } catch (e) {
      this.record(
        'device->host',
        'feature-get',
        reportId,
        new Uint8Array(),
        performance.now() - t0,
        e,
      );
      throw e;
    }
  }

  async readInputReport(timeoutMs: number): Promise<Uint8Array | null> {
    const t0 = performance.now();
    const r = await this.inner.readInputReport(timeoutMs);
    if (r) this.record('device->host', 'input', 0, r, performance.now() - t0);
    return r;
  }

  drainInput(): void {
    this.inner.drainInput();
  }

  private record(
    direction: 'host->device' | 'device->host',
    kind: 'output' | 'input' | 'feature-set' | 'feature-get',
    reportId: number,
    bytes: Uint8Array,
    durationMs: number,
    error?: unknown,
  ): void {
    this.log.add({
      direction,
      kind,
      iface: this.label,
      usagePage: this.usagePage,
      reportId,
      bytes: bytes.slice(),
      durationMs,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    });
  }
}

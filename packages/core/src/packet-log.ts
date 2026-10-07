import { toHexCompact } from './bytes.js';

export type PacketDirection = 'host->device' | 'device->host';
export type PacketKind = 'output' | 'input' | 'feature-set' | 'feature-get';

export interface PacketRecord {
  /** Milliseconds since the log was created. */
  t: number;
  direction: PacketDirection;
  kind: PacketKind;
  /** Short label of the HID interface, e.g. `if3 FF13:0001`. */
  iface: string;
  usagePage: number;
  reportId: number;
  bytes: Uint8Array;
  /** Human readable decode supplied by the protocol layer when known. */
  decoded?: string;
  /** Duration of the underlying I/O call in ms (for writes) or wait time (for reads). */
  durationMs?: number;
  error?: string;
}

export type PacketSink = (record: PacketRecord) => void;

/**
 * Bounded in-memory packet log with optional listeners. Instances are passed explicitly to
 * transports; there is no hidden global log.
 */
export class PacketLog {
  private readonly records: PacketRecord[] = [];
  private readonly listeners = new Set<PacketSink>();
  private readonly start = Date.now();

  constructor(private readonly capacity = 2000) {}

  now(): number {
    return Date.now() - this.start;
  }

  add(record: Omit<PacketRecord, 't'> & { t?: number }): PacketRecord {
    const full: PacketRecord = { ...record, t: record.t ?? this.now() };
    this.records.push(full);
    if (this.records.length > this.capacity)
      this.records.splice(0, this.records.length - this.capacity);
    for (const l of this.listeners) l(full);
    return full;
  }

  /** Attach a decode string to the most recent record matching the predicate. */
  annotateLast(decoded: string, predicate: (r: PacketRecord) => boolean = () => true): void {
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i]!;
      if (predicate(r)) {
        r.decoded = decoded;
        return;
      }
    }
  }

  subscribe(sink: PacketSink): () => void {
    this.listeners.add(sink);
    return () => this.listeners.delete(sink);
  }

  all(): readonly PacketRecord[] {
    return this.records;
  }

  clear(): void {
    this.records.length = 0;
  }

  toJSON(): unknown[] {
    return this.records.map((r) => ({
      t: r.t,
      direction: r.direction,
      kind: r.kind,
      iface: r.iface,
      usagePage: r.usagePage,
      reportId: r.reportId,
      hex: Array.from(r.bytes, (b) => b.toString(16).padStart(2, '0')).join(' '),
      decoded: r.decoded,
      durationMs: r.durationMs,
      error: r.error,
    }));
  }
}

export function formatPacket(r: PacketRecord): string {
  const arrow = r.direction === 'host->device' ? '>>' : '<<';
  const head = `[${String(r.t).padStart(6)}ms] ${arrow} ${r.kind.padEnd(11)} ${r.iface} id=${r.reportId} len=${r.bytes.length}`;
  const dur = r.durationMs !== undefined ? ` (${r.durationMs.toFixed(1)}ms)` : '';
  const dec = r.decoded ? `\n           ${r.decoded}` : '';
  const err = r.error ? `\n           ERROR: ${r.error}` : '';
  return `${head}${dur}\n           ${toHexCompact(r.bytes)}${dec}${err}`;
}

/** True when OPENKEY_DEBUG=1 (Node) or localStorage["openkey.debug"]="1" (browser). */
export function isDebugEnabled(): boolean {
  try {
    const g = globalThis as {
      process?: { env?: Record<string, string | undefined> };
      localStorage?: Storage;
    };
    const env = g.process?.env;
    if (env?.OPENKEY_DEBUG === '1' || env?.OPENAK820_DEBUG === '1') return true;
    if (g.localStorage?.getItem('openkey.debug') === '1') return true;
  } catch {
    // Storage may be unavailable (private mode, sandboxed iframe).
  }
  return false;
}

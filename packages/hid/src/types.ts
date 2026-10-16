import type { DeviceIdentity, TransportMode } from '@openkey/core';

/** One report declared by a HID collection. `size` is in bytes, excluding the report-ID prefix. */
export interface HidReportInfo {
  reportId: number;
  size: number;
}

/** Mirrors WebHID's HIDCollectionInfo, reduced to what protocol detection needs. */
export interface HidCollection {
  usagePage: number;
  usage: number;
  inputReports: HidReportInfo[];
  outputReports: HidReportInfo[];
  featureReports: HidReportInfo[];
}

/**
 * One HID interface as the OS exposes it (a hidraw node on Linux, an HIDDevice in WebHID).
 * Protocol code identifies interfaces by their collections, never by number or path.
 */
export interface HidInterfaceInfo {
  /** USB interface number when the platform reveals it (Linux); undefined in WebHID. */
  interfaceNumber?: number;
  /** Platform handle for diagnostics only, e.g. /dev/hidraw7. Never used by protocol code. */
  path?: string;
  collections: HidCollection[];
  /** Raw report descriptor when available (Linux sysfs). */
  descriptor?: Uint8Array;
  /**
   * False when the platform reports usage pages but not report sizes (node-hid on macOS/Windows).
   * Matchers then rely on the read-only probe instead of report sizes.
   */
  sizesKnown?: boolean;
}

/** A physical keyboard: all HID interfaces sharing one USB device. */
export interface HidDeviceGroupInfo {
  key: string;
  identity: DeviceIdentity;
  interfaces: HidInterfaceInfo[];
  /** `offline`: rebuilt from a diagnostic file; it can never open a transport. */
  backend: 'webhid' | 'linux-hidraw' | 'node-hid' | 'mock' | 'offline' | 'web-serial';
  /** Best guess of the link type from identity alone; protocols may refine it. */
  transportHint: TransportMode;
  /** Extra platform facts for diagnostics (endpoints, bus, …). */
  platform?: Record<string, unknown>;
}

/** An open channel to one HID interface. Report data never includes the report-ID byte. */
export interface HidTransport {
  readonly info: HidInterfaceInfo;
  readonly label: string;
  readonly opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  sendOutputReport(reportId: number, data: Uint8Array): Promise<void>;
  sendFeatureReport(reportId: number, data: Uint8Array): Promise<void>;
  /** Returns the report payload without the report-ID byte. */
  receiveFeatureReport(reportId: number, length: number): Promise<Uint8Array>;
  /** Waits for the next input report; resolves null on timeout. */
  readInputReport(timeoutMs: number): Promise<Uint8Array | null>;
  /** Discards queued input reports. */
  drainInput(): void;
}

/** A device group that can open transports for its interfaces. */
export interface HidDeviceGroup extends HidDeviceGroupInfo {
  openInterface(iface: HidInterfaceInfo): Promise<HidTransport>;
}

export function primaryUsagePage(iface: HidInterfaceInfo): number | undefined {
  return iface.collections[0]?.usagePage;
}

export function interfaceLabel(iface: HidInterfaceInfo): string {
  const c = iface.collections[0];
  const up = c
    ? `${c.usagePage.toString(16).toUpperCase().padStart(4, '0')}:${c.usage.toString(16).toUpperCase().padStart(4, '0')}`
    : '????';
  return iface.interfaceNumber !== undefined ? `if${iface.interfaceNumber} ${up}` : up;
}

/** Finds the interface exposing a collection that satisfies the predicate. */
export function findInterface(
  group: HidDeviceGroupInfo,
  predicate: (c: HidCollection) => boolean,
): HidInterfaceInfo | undefined {
  return group.interfaces.find((i) => i.collections.some(predicate));
}

export function maxReportSize(reports: HidReportInfo[], reportId?: number): number {
  const list = reportId === undefined ? reports : reports.filter((r) => r.reportId === reportId);
  return list.reduce((m, r) => Math.max(m, r.size), 0);
}

export function isVendorPage(usagePage: number): boolean {
  return usagePage >= 0xff00;
}

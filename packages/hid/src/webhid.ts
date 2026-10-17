import { PermissionError, TransportError, WebHidUnavailableError } from '@openkey/core';
import type { TransportMode } from '@openkey/core';
import { InputQueue } from './input-queue.js';
import type {
  HidCollection,
  HidDeviceGroup,
  HidInterfaceInfo,
  HidReportInfo,
  HidTransport,
} from './types.js';
import { interfaceLabel, maxReportSize } from './types.js';

/** Minimal structural view of the WebHID API so this module compiles without DOM lib quirks. */
type HidApi = HID;

export function getWebHid(): HidApi | undefined {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  return nav && 'hid' in nav ? (nav as Navigator & { hid: HidApi }).hid : undefined;
}

export interface WebHidSupport {
  available: boolean;
  secureContext: boolean;
  reason?: string;
}

export function webHidSupport(): WebHidSupport {
  const secure =
    typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : false;
  if (!getWebHid()) {
    return {
      available: false,
      secureContext: secure,
      reason: secure
        ? 'This browser does not implement WebHID. Use Chrome, Edge, Opera or another Chromium-based browser.'
        : 'WebHID requires a secure context (HTTPS or http://localhost).',
    };
  }
  return { available: true, secureContext: secure };
}

function toReports(list: readonly HIDReportInfo[] | undefined): HidReportInfo[] {
  return (list ?? []).map((r) => ({
    reportId: r.reportId ?? 0,
    size: Math.ceil(
      (r.items ?? []).reduce((bits, it) => bits + (it.reportSize ?? 0) * (it.reportCount ?? 0), 0) /
        8,
    ),
  }));
}

function toCollection(c: HIDCollectionInfo): HidCollection {
  const out: HidCollection = {
    usagePage: c.usagePage ?? 0,
    usage: c.usage ?? 0,
    inputReports: toReports(c.inputReports),
    outputReports: toReports(c.outputReports),
    featureReports: toReports(c.featureReports),
  };
  const children = flattenChildren(c.children);
  if (children.length) out.children = children;
  return out;
}

/** Nested collections in descriptor order, flattened; each keeps only its own reports. */
function flattenChildren(list: readonly HIDCollectionInfo[] | undefined): HidCollection[] {
  return (list ?? []).flatMap((c) => {
    const { children, ...own } = toCollection(c);
    return [own, ...(children ?? [])];
  });
}

export function collectionsOf(device: HIDDevice): HidCollection[] {
  return (device.collections ?? []).map(toCollection);
}

export class WebHidTransport implements HidTransport {
  readonly info: HidInterfaceInfo;
  readonly label: string;
  private readonly queue = new InputQueue();
  private readonly onInput = (e: HIDInputReportEvent): void => {
    this.queue.push(
      new Uint8Array(e.data.buffer.slice(e.data.byteOffset, e.data.byteOffset + e.data.byteLength)),
    );
  };

  constructor(readonly device: HIDDevice) {
    this.info = { collections: collectionsOf(device) };
    this.label = interfaceLabel(this.info);
  }

  get opened(): boolean {
    return this.device.opened;
  }

  async open(): Promise<void> {
    if (!this.device.opened) {
      try {
        await this.device.open();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/permission|denied|NotAllowed/i.test(msg))
          throw new PermissionError(`Cannot open ${this.label}: ${msg}`, {}, { cause: e });
        throw new TransportError(
          `Cannot open ${this.label}: ${msg}. Another program may be using the keyboard.`,
          {},
          { cause: e },
        );
      }
    }
    this.device.addEventListener('inputreport', this.onInput);
  }

  async close(): Promise<void> {
    this.device.removeEventListener('inputreport', this.onInput);
    this.queue.clear();
    if (this.device.opened) await this.device.close();
  }

  async sendOutputReport(reportId: number, data: Uint8Array): Promise<void> {
    try {
      await this.device.sendReport(reportId, data as Uint8Array<ArrayBuffer>);
    } catch (e) {
      throw new TransportError(
        `sendReport failed on ${this.label}: ${String(e)}`,
        { reportId, length: data.length },
        { cause: e },
      );
    }
  }

  async sendFeatureReport(reportId: number, data: Uint8Array): Promise<void> {
    try {
      await this.device.sendFeatureReport(reportId, data as Uint8Array<ArrayBuffer>);
    } catch (e) {
      throw new TransportError(
        `sendFeatureReport failed on ${this.label}: ${String(e)}`,
        { reportId, length: data.length },
        { cause: e },
      );
    }
  }

  async receiveFeatureReport(reportId: number, length: number): Promise<Uint8Array> {
    let view: DataView;
    try {
      view = await this.device.receiveFeatureReport(reportId);
    } catch (e) {
      throw new TransportError(
        `receiveFeatureReport failed on ${this.label}: ${String(e)}`,
        { reportId },
        { cause: e },
      );
    }
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
    // Some platforms prefix the report ID even for unnumbered reports; normalise to payload only.
    if (bytes.length === length + 1 && bytes[0] === reportId) return bytes.subarray(1);
    return bytes;
  }

  readInputReport(timeoutMs: number): Promise<Uint8Array | null> {
    return this.queue.next(timeoutMs);
  }

  drainInput(): void {
    this.queue.clear();
  }

  featureSize(reportId = 0): number {
    return maxReportSize(
      this.info.collections.flatMap((c) => c.featureReports),
      reportId,
    );
  }
}

/** Known identity hints. Bus type is authoritative when the platform reports it (Linux). */
export function transportHintFromIdentity(
  vendorId: number,
  productId: number,
  productName: string,
): TransportMode {
  if (/dongle|receiver|2\.4g/i.test(productName)) return '2.4ghz';
  if (vendorId === 0x0c45 && productId === 0xfdfd) return '2.4ghz';
  if (vendorId === 0x05ac && productId === 0x024f) return '2.4ghz';
  if (vendorId === 0x0c45 && productId === 0xfefe) return 'bluetooth';
  return 'usb';
}

export class WebHidBackend {
  constructor(private readonly hid: HidApi = getWebHid() as HidApi) {
    if (!hid) throw new WebHidUnavailableError();
  }

  /** Opens the browser chooser. Filters are deliberately broad: detection happens afterwards. */
  async request(filters: HIDDeviceFilter[]): Promise<HidDeviceGroup[]> {
    let devices: HIDDevice[];
    try {
      devices = await this.hid.requestDevice({ filters });
    } catch (e) {
      throw new PermissionError(`Device request was rejected: ${String(e)}`, {}, { cause: e });
    }
    if (devices.length === 0) return [];
    // The chooser returns only one HID interface per pick on some platforms; include sibling
    // interfaces of the same physical device that were already granted.
    const granted = await this.hid.getDevices();
    return groupHidDevices(
      mergeUnique(
        devices,
        granted.filter((g) => devices.some((d) => sameDevice(d, g))),
      ),
    );
  }

  async granted(): Promise<HidDeviceGroup[]> {
    return groupHidDevices(await this.hid.getDevices());
  }

  onDisconnect(cb: (device: HIDDevice) => void): () => void {
    const h = (e: HIDConnectionEvent): void => cb(e.device);
    this.hid.addEventListener('disconnect', h);
    return () => this.hid.removeEventListener('disconnect', h);
  }

  onConnect(cb: (device: HIDDevice) => void): () => void {
    const h = (e: HIDConnectionEvent): void => cb(e.device);
    this.hid.addEventListener('connect', h);
    return () => this.hid.removeEventListener('connect', h);
  }
}

function sameDevice(a: HIDDevice, b: HIDDevice): boolean {
  return (
    a.vendorId === b.vendorId && a.productId === b.productId && a.productName === b.productName
  );
}

function mergeUnique(a: HIDDevice[], b: HIDDevice[]): HIDDevice[] {
  const out = [...a];
  for (const d of b) if (!out.includes(d)) out.push(d);
  return out;
}

export function groupHidDevices(devices: HIDDevice[]): HidDeviceGroup[] {
  const groups = new Map<string, HIDDevice[]>();
  for (const d of devices) {
    const key = `${d.vendorId}:${d.productId}:${d.productName}`;
    const list = groups.get(key) ?? [];
    if (!list.includes(d)) list.push(d);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, list]) => {
    const first = list[0]!;
    const transports = new Map<HidInterfaceInfo, HIDDevice>();
    const interfaces = list.map((d) => {
      const info: HidInterfaceInfo = { collections: collectionsOf(d) };
      transports.set(info, d);
      return info;
    });
    return {
      key,
      identity: {
        vendorId: first.vendorId,
        productId: first.productId,
        productName: first.productName,
      },
      interfaces,
      backend: 'webhid' as const,
      transportHint: transportHintFromIdentity(first.vendorId, first.productId, first.productName),
      async openInterface(iface: HidInterfaceInfo): Promise<HidTransport> {
        const dev = transports.get(iface);
        if (!dev) throw new TransportError('Interface does not belong to this device group');
        const t = new WebHidTransport(dev);
        await t.open();
        return t;
      },
    };
  });
}

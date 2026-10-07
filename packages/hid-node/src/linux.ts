import { promises as fs, constants as fsConstants } from 'node:fs';
import { PermissionError, TransportError } from '@openkey/core';
import type { TransportMode } from '@openkey/core';
import { InputQueue, interfaceLabel, transportHintFromIdentity } from '@openkey/hid';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import { busTransport, groupKey, nodeToInterface, scanHidraw } from './sysfs.js';
import type { LinuxHidrawNode } from './sysfs.js';

type HidAsyncDevice = {
  write(data: number[] | Buffer): Promise<number>;
  sendFeatureReport(data: number[] | Buffer): Promise<number>;
  getFeatureReport(reportId: number, length: number): Promise<Buffer>;
  read(timeoutMs?: number): Promise<Buffer | undefined>;
  close(): Promise<void>;
};

async function loadNodeHid(): Promise<{
  HIDAsync: { open(path: string): Promise<HidAsyncDevice> };
}> {
  try {
    const mod = (await import('node-hid')) as unknown as { default?: unknown; HIDAsync?: unknown };
    return (mod.HIDAsync ? mod : mod.default) as {
      HIDAsync: { open(path: string): Promise<HidAsyncDevice> };
    };
  } catch (e) {
    throw new TransportError(
      'The node-hid native module could not be loaded. Run "pnpm install" on this machine.',
      {},
      { cause: e },
    );
  }
}

export const UDEV_HINT =
  'Install the udev rule: sudo cp udev/99-openkey.rules /etc/udev/rules.d/ && sudo udevadm control --reload-rules && sudo udevadm trigger, then replug the keyboard.';

/**
 * HID transport over a Linux hidraw node. Uses hidapi's hidraw backend (via node-hid) because
 * feature reports need the HIDIOCSFEATURE/HIDIOCGFEATURE ioctls.
 */
export class LinuxHidRawTransport implements HidTransport {
  readonly label: string;
  private dev: HidAsyncDevice | null = null;
  private readonly pending = new InputQueue();

  constructor(readonly info: HidInterfaceInfo) {
    this.label = `${interfaceLabel(info)} ${info.path ?? ''}`.trim();
  }

  get opened(): boolean {
    return this.dev !== null;
  }

  async open(): Promise<void> {
    if (this.dev) return;
    const p = this.info.path;
    if (!p) throw new TransportError('Interface has no hidraw path');
    try {
      await fs.access(p, fsConstants.R_OK | fsConstants.W_OK);
    } catch {
      throw new PermissionError(`No read/write permission for ${p}. ${UDEV_HINT}`, { path: p });
    }
    const hid = await loadNodeHid();
    try {
      this.dev = await hid.HIDAsync.open(p);
    } catch (e) {
      throw new TransportError(`Cannot open ${p}: ${String(e)}`, { path: p }, { cause: e });
    }
  }

  async close(): Promise<void> {
    const d = this.dev;
    this.dev = null;
    this.pending.cancelAll();
    if (d) await d.close().catch(() => undefined);
  }

  private device(): HidAsyncDevice {
    if (!this.dev) throw new TransportError(`${this.label} is not open`);
    return this.dev;
  }

  async sendOutputReport(reportId: number, data: Uint8Array): Promise<void> {
    // hidraw always takes the report number as the first byte; for unnumbered reports the kernel
    // strips the leading 0x00. Omitting it would drop the first payload byte whenever it is 0x00.
    const buf = Buffer.alloc(data.length + 1);
    buf[0] = reportId;
    buf.set(data, 1);
    try {
      const n = await this.device().write(buf);
      if (n !== buf.length)
        throw new TransportError(`Short write on ${this.label}: ${n}/${buf.length}`);
    } catch (e) {
      if (e instanceof TransportError) throw e;
      throw new TransportError(
        `Output report failed on ${this.label}: ${String(e)}`,
        { reportId, length: data.length },
        { cause: e },
      );
    }
  }

  async sendFeatureReport(reportId: number, data: Uint8Array): Promise<void> {
    const buf = Buffer.alloc(data.length + 1);
    buf[0] = reportId;
    buf.set(data, 1);
    try {
      await this.device().sendFeatureReport(buf);
    } catch (e) {
      throw new TransportError(
        `Feature report (SET) failed on ${this.label}: ${String(e)}`,
        { reportId },
        { cause: e },
      );
    }
  }

  async receiveFeatureReport(reportId: number, length: number): Promise<Uint8Array> {
    try {
      const r = await this.device().getFeatureReport(reportId, length + 1);
      const bytes = new Uint8Array(r);
      return bytes.length === length + 1 ? bytes.subarray(1).slice() : bytes;
    } catch (e) {
      throw new TransportError(
        `Feature report (GET) failed on ${this.label}: ${String(e)}`,
        { reportId },
        { cause: e },
      );
    }
  }

  async readInputReport(timeoutMs: number): Promise<Uint8Array | null> {
    try {
      const r = await this.device().read(timeoutMs);
      return r && r.length ? new Uint8Array(r) : null;
    } catch (e) {
      throw new TransportError(
        `Input read failed on ${this.label}: ${String(e)}`,
        {},
        { cause: e },
      );
    }
  }

  drainInput(): void {
    // node-hid buffers in the kernel; reads with timeout 0 are done by callers that need draining.
  }
}

export interface LinuxDeviceGroup extends HidDeviceGroup {
  nodes: LinuxHidrawNode[];
}

/** Groups hidraw nodes by physical device. Optionally filters by vendor IDs. */
export async function enumerateLinux(
  opts: { vendorIds?: number[] } = {},
): Promise<LinuxDeviceGroup[]> {
  const nodes = (await scanHidraw()).filter(
    (n) => !opts.vendorIds || opts.vendorIds.includes(n.vendorId),
  );
  const byKey = new Map<string, LinuxHidrawNode[]>();
  for (const n of nodes) {
    const k = groupKey(n);
    byKey.set(k, [...(byKey.get(k) ?? []), n]);
  }
  return [...byKey.entries()].map(([key, list]) => {
    const first = list[0]!;
    const usb = first.usbDevice;
    const productName = usb?.product ?? first.hidName;
    const interfaces = list.map(nodeToInterface);
    const busMode = busTransport(first.bus);
    const transportHint: TransportMode =
      busMode === 'bluetooth'
        ? 'bluetooth'
        : transportHintFromIdentity(first.vendorId, first.productId, productName);
    return {
      key,
      identity: {
        vendorId: first.vendorId,
        productId: first.productId,
        productName,
        ...(usb?.manufacturer ? { manufacturer: usb.manufacturer } : {}),
        ...(usb?.serial ? { serialNumber: usb.serial } : {}),
        ...(usb ? { release: usb.bcdDevice } : {}),
      },
      interfaces,
      backend: 'linux-hidraw' as const,
      transportHint,
      platform: {
        bus: first.bus,
        usbPath: usb?.sysPath,
        speed: usb?.speed,
        nodes: list.map((n) => ({
          node: n.node,
          interfaceNumber: n.interfaceNumber,
          endpoints: n.endpoints,
          accessible: n.accessible,
        })),
      },
      nodes: list,
      async openInterface(iface: HidInterfaceInfo): Promise<HidTransport> {
        const t = new LinuxHidRawTransport(iface);
        await t.open();
        return t;
      },
    };
  });
}

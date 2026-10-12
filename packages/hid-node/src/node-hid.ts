import { transportHintFromIdentity } from '@openkey/hid';
import type { HidDeviceGroup, HidInterfaceInfo, HidTransport } from '@openkey/hid';
import { NodeHidTransport } from './linux.js';

/** One entry of node-hid's `HID.devices()`: a top-level collection (Windows) or interface (macOS). */
export interface NodeHidDeviceInfo {
  vendorId: number;
  productId: number;
  path?: string;
  product?: string;
  manufacturer?: string;
  serialNumber?: string;
  release?: number;
  interface?: number;
  usagePage?: number;
  usage?: number;
}

export interface NodeHidDeviceGroup extends HidDeviceGroup {
  backend: 'node-hid';
}

/**
 * Groups node-hid entries into physical devices. hidapi on macOS and Windows reports usage pages
 * but not report sizes, so every interface is marked `sizesKnown: false`: matchers then rely on the
 * identification probe instead of report sizes. Pure, so it is tested without hardware.
 */
export function groupNodeHidDevices(
  list: NodeHidDeviceInfo[],
  opts: { vendorIds?: number[] } = {},
): NodeHidDeviceGroup[] {
  const byKey = new Map<string, NodeHidDeviceInfo[]>();
  for (const d of list) {
    if (!d.path) continue;
    if (opts.vendorIds && !opts.vendorIds.includes(d.vendorId)) continue;
    const key = `${d.vendorId}:${d.productId}:${d.product ?? ''}:${d.serialNumber ?? ''}`;
    byKey.set(key, [...(byKey.get(key) ?? []), d]);
  }
  return [...byKey.entries()].map(([key, entries]) => {
    const first = entries[0]!;
    // The same path can appear once per usage on some platforms: one interface per path.
    const paths = new Map<string, HidInterfaceInfo>();
    for (const e of entries) {
      const info = paths.get(e.path!) ?? {
        ...(e.interface !== undefined && e.interface >= 0 ? { interfaceNumber: e.interface } : {}),
        path: e.path!,
        collections: [],
        sizesKnown: false,
      };
      info.collections.push({
        usagePage: e.usagePage ?? 0,
        usage: e.usage ?? 0,
        inputReports: [],
        outputReports: [],
        featureReports: [],
      });
      paths.set(e.path!, info);
    }
    const productName = first.product ?? '';
    return {
      key,
      identity: {
        vendorId: first.vendorId,
        productId: first.productId,
        productName,
        ...(first.manufacturer ? { manufacturer: first.manufacturer } : {}),
        ...(first.release !== undefined ? { release: first.release } : {}),
      },
      interfaces: [...paths.values()],
      backend: 'node-hid' as const,
      transportHint: transportHintFromIdentity(first.vendorId, first.productId, productName),
      platform: { os: process.platform, paths: [...paths.keys()] },
      async openInterface(iface: HidInterfaceInfo): Promise<HidTransport> {
        const t = new NodeHidTransport(iface);
        await t.open();
        return t;
      },
    };
  });
}

/** Enumerates HID devices through node-hid (macOS, Windows; also works on Linux). */
export async function enumerateNodeHid(
  opts: { vendorIds?: number[] } = {},
): Promise<NodeHidDeviceGroup[]> {
  const mod = (await import('node-hid')) as unknown as {
    devices?: () => NodeHidDeviceInfo[];
    default?: { devices: () => NodeHidDeviceInfo[] };
  };
  const devices = mod.devices ?? mod.default?.devices;
  if (!devices) throw new Error('node-hid does not provide devices()');
  return groupNodeHidDevices(devices(), opts);
}

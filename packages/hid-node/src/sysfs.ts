import { promises as fs, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import type { TransportMode } from '@openak820/core';
import { parseReportDescriptor } from '@openak820/hid';
import type { HidInterfaceInfo } from '@openak820/hid';

/** Linux HID bus types from include/uapi/linux/input.h */
const BUS_USB = 0x03;
const BUS_BLUETOOTH = 0x05;

export interface UsbEndpointInfo {
  address: number;
  direction: 'in' | 'out';
  transferType: string;
  maxPacketSize: number;
  interval: number;
}

export interface LinuxHidrawNode {
  node: string;
  sysPath: string;
  bus: number;
  vendorId: number;
  productId: number;
  hidName: string;
  hidPhys: string;
  hidUniq: string;
  descriptor: Uint8Array;
  interfaceNumber?: number;
  interfaceClass?: { cls: number; subclass: number; protocol: number };
  endpoints: UsbEndpointInfo[];
  usbDevice?: {
    sysPath: string;
    busnum: number;
    devnum: number;
    idVendor: number;
    idProduct: number;
    bcdDevice: number;
    manufacturer?: string;
    product?: string;
    serial?: string;
    speed?: string;
  };
  accessible: { read: boolean; write: boolean };
}

async function readText(p: string): Promise<string | undefined> {
  try {
    return (await fs.readFile(p, 'utf8')).trim();
  } catch {
    return undefined;
  }
}

async function readHex(p: string): Promise<number | undefined> {
  const t = await readText(p);
  return t === undefined ? undefined : parseInt(t, 16);
}

async function canAccess(p: string, mode: number): Promise<boolean> {
  try {
    await fs.access(p, mode);
    return true;
  } catch {
    return false;
  }
}

async function readEndpoints(ifaceDir: string): Promise<UsbEndpointInfo[]> {
  const out: UsbEndpointInfo[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(ifaceDir);
  } catch {
    return out;
  }
  for (const e of entries.filter((n) => /^ep_[0-9a-f]{2}$/.test(n))) {
    const dir = path.join(ifaceDir, e);
    const address = (await readHex(path.join(dir, 'bEndpointAddress'))) ?? 0;
    out.push({
      address,
      direction: (await readText(path.join(dir, 'direction'))) === 'out' ? 'out' : 'in',
      transferType: (await readText(path.join(dir, 'type'))) ?? 'unknown',
      maxPacketSize: (await readHex(path.join(dir, 'wMaxPacketSize'))) ?? 0,
      interval: parseInt((await readText(path.join(dir, 'bInterval'))) ?? '0', 16),
    });
  }
  return out.sort((a, b) => a.address - b.address);
}

/** Walks /sys/class/hidraw. Requires no special permissions. */
export async function scanHidraw(sysRoot = '/sys'): Promise<LinuxHidrawNode[]> {
  const classDir = path.join(sysRoot, 'class/hidraw');
  let names: string[];
  try {
    names = await fs.readdir(classDir);
  } catch {
    return [];
  }
  const nodes: LinuxHidrawNode[] = [];
  for (const name of names.sort(
    (a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')),
  )) {
    const hidDev = await fs.realpath(path.join(classDir, name, 'device')).catch(() => undefined);
    if (!hidDev) continue;
    const uevent = (await readText(path.join(hidDev, 'uevent'))) ?? '';
    const kv = Object.fromEntries(uevent.split('\n').map((l) => l.split('=') as [string, string]));
    const id = /^([0-9A-F]+):([0-9A-F]+):([0-9A-F]+)$/i.exec(kv.HID_ID ?? '');
    if (!id) continue;
    const descriptor = new Uint8Array(
      await fs.readFile(path.join(hidDev, 'report_descriptor')).catch(() => Buffer.alloc(0)),
    );
    const ifaceDir = path.dirname(hidDev);
    const usbDir = path.dirname(ifaceDir);
    const node: LinuxHidrawNode = {
      node: `/dev/${name}`,
      sysPath: hidDev,
      bus: parseInt(id[1]!, 16),
      vendorId: parseInt(id[2]!, 16),
      productId: parseInt(id[3]!, 16),
      hidName: kv.HID_NAME ?? '',
      hidPhys: kv.HID_PHYS ?? '',
      hidUniq: kv.HID_UNIQ ?? '',
      descriptor,
      endpoints: [],
      accessible: {
        read: await canAccess(`/dev/${name}`, fsConstants.R_OK),
        write: await canAccess(`/dev/${name}`, fsConstants.W_OK),
      },
    };
    if (node.bus === BUS_USB) {
      const ifNum = await readHex(path.join(ifaceDir, 'bInterfaceNumber'));
      if (ifNum !== undefined) {
        node.interfaceNumber = ifNum;
        node.interfaceClass = {
          cls: (await readHex(path.join(ifaceDir, 'bInterfaceClass'))) ?? 0,
          subclass: (await readHex(path.join(ifaceDir, 'bInterfaceSubClass'))) ?? 0,
          protocol: (await readHex(path.join(ifaceDir, 'bInterfaceProtocol'))) ?? 0,
        };
        node.endpoints = await readEndpoints(ifaceDir);
      }
      const idVendor = await readHex(path.join(usbDir, 'idVendor'));
      if (idVendor !== undefined) {
        node.usbDevice = {
          sysPath: usbDir,
          busnum: Number(await readText(path.join(usbDir, 'busnum'))),
          devnum: Number(await readText(path.join(usbDir, 'devnum'))),
          idVendor,
          idProduct: (await readHex(path.join(usbDir, 'idProduct'))) ?? 0,
          bcdDevice: (await readHex(path.join(usbDir, 'bcdDevice'))) ?? 0,
          ...(await optional('manufacturer', readText(path.join(usbDir, 'manufacturer')))),
          ...(await optional('product', readText(path.join(usbDir, 'product')))),
          ...(await optional('serial', readText(path.join(usbDir, 'serial')))),
          ...(await optional('speed', readText(path.join(usbDir, 'speed')))),
        };
      }
    }
    nodes.push(node);
  }
  return nodes;
}

async function optional<K extends string>(
  key: K,
  p: Promise<string | undefined>,
): Promise<Partial<Record<K, string>>> {
  const v = await p;
  return v ? ({ [key]: v } as Record<K, string>) : {};
}

export function busTransport(bus: number): TransportMode {
  if (bus === BUS_BLUETOOTH) return 'bluetooth';
  if (bus === BUS_USB) return 'usb';
  return 'unknown';
}

export function nodeToInterface(n: LinuxHidrawNode): HidInterfaceInfo {
  return {
    ...(n.interfaceNumber !== undefined ? { interfaceNumber: n.interfaceNumber } : {}),
    path: n.node,
    collections: parseReportDescriptor(n.descriptor),
    descriptor: n.descriptor,
  };
}

/** Physical-device grouping key: the USB device directory, or HID phys/uniq for Bluetooth. */
export function groupKey(n: LinuxHidrawNode): string {
  if (n.usbDevice) return n.usbDevice.sysPath;
  return `${n.bus}:${n.vendorId}:${n.productId}:${n.hidUniq || n.hidPhys.replace(/\/input\d+$/, '')}`;
}

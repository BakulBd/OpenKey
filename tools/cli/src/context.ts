import { createInterface } from 'node:readline/promises';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DeviceNotFoundError, PacketLog, formatPacket, isDebugEnabled } from '@openak820/core';
import type { KeyboardDriver, StateStore } from '@openak820/core';
import { FileStateStore, defaultStateDir, enumerateLinux } from '@openak820/hid-node';
import type { LinuxDeviceGroup } from '@openak820/hid-node';
import { connectKeyboard, createDefaultRegistry } from '@openak820/protocols';
import type { DetectionReport, ProbeLevel } from '@openak820/protocols';

/** Vendor IDs used by AK820-family keyboards and receivers. 0x05AC only for the Apple-VID 2.4G dongle. */
export const FAMILY_VENDOR_IDS = [0x0c45, 0x1a2c, 0x05ac];

export interface GlobalFlags {
  device?: string;
  protocol?: string;
  level?: ProbeLevel;
  json: boolean;
  verbose: boolean;
  yes: boolean;
  experimental: boolean;
  debug: boolean;
}

export async function listGroups(): Promise<LinuxDeviceGroup[]> {
  const groups = await enumerateLinux({ vendorIds: FAMILY_VENDOR_IDS });
  // The Apple VID is only interesting for the AK820 receiver product.
  return groups.filter((g) => g.identity.vendorId !== 0x05ac || g.identity.productId === 0x024f);
}

export async function pickGroup(flags: GlobalFlags): Promise<LinuxDeviceGroup> {
  const groups = await listGroups();
  if (groups.length === 0) throw new DeviceNotFoundError();
  if (!flags.device) {
    // Prefer a group whose descriptors look configurable (has a vendor page with feature/output).
    return (
      groups.find((g) =>
        g.interfaces.some((i) =>
          i.collections.some((c) => c.usagePage >= 0xff00 && c.usagePage !== 0xffff),
        ),
      ) ?? groups[0]!
    );
  }
  const byIndex = Number(flags.device);
  if (Number.isInteger(byIndex) && groups[byIndex]) return groups[byIndex]!;
  const g = groups.find(
    (x) => x.key.includes(flags.device!) || x.identity.productName === flags.device,
  );
  if (!g) throw new DeviceNotFoundError(`No device matches "${flags.device}"`);
  return g;
}

export function makeLog(flags: GlobalFlags): PacketLog {
  const log = new PacketLog();
  if (flags.debug || isDebugEnabled())
    log.subscribe((r) => process.stderr.write(`${formatPacket(r)}\n`));
  return log;
}

export function stateStore(): StateStore {
  return new FileStateStore();
}

export async function connect(flags: GlobalFlags): Promise<{
  driver: KeyboardDriver;
  detection: DetectionReport;
  log: PacketLog;
  group: LinuxDeviceGroup;
}> {
  const group = await pickGroup(flags);
  const log = makeLog(flags);
  const res = await connectKeyboard(group, {
    registry: createDefaultRegistry(),
    level: flags.level ?? 'handshake',
    log,
    store: stateStore(),
    ...(flags.protocol ? { protocolId: flags.protocol } : {}),
    allowExperimental: flags.experimental,
  });
  return { ...res, group };
}

export async function confirm(flags: GlobalFlags, question: string): Promise<boolean> {
  if (flags.yes) return true;
  if (!process.stdin.isTTY) {
    console.error(`${question}\nRefusing to write without confirmation; pass --yes.`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

export async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function backupDir(): string {
  return path.join(defaultStateDir(), 'backups');
}

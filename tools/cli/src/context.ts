import { createInterface } from 'node:readline/promises';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DeviceNotFoundError, PacketLog, formatPacket, guardWrites, isDebugEnabled } from '@openkey/core';
import type { KeyboardDriver, StateStore } from '@openkey/core';
import { FileStateStore, defaultStateDir, enumerateLinux, enumerateNodeHid } from '@openkey/hid-node';
import type { HidDeviceGroup } from '@openkey/hid';
import { connectKeyboard, createDefaultRegistry } from '@openkey/protocols';
import type { DetectionReport, ProbeLevel } from '@openkey/protocols';

/** Vendor IDs used by AK820-family keyboards and receivers. 0x05AC only for the Apple-VID 2.4G dongle. */
export const FAMILY_VENDOR_IDS = [0x0c45, 0x1a2c, 0x05ac];

export interface GlobalFlags {
  device?: string;
  protocol?: string;
  level?: ProbeLevel;
  /** Adapter ids whose identification handshake the user allowed (--allow-probe). */
  consent: string[];
  json: boolean;
  verbose: boolean;
  yes: boolean;
  experimental: boolean;
  debug: boolean;
}

/**
 * AK820-family devices on this machine. Linux reads sysfs (interface numbers, endpoints, report
 * sizes, bcdDevice); macOS and Windows use hidapi's enumeration through node-hid, which reports
 * usage pages but not report sizes, so identification relies on the documented handshake there.
 */
export async function listGroups(): Promise<HidDeviceGroup[]> {
  const groups: HidDeviceGroup[] =
    process.platform === 'linux' ? await enumerateLinux({ vendorIds: FAMILY_VENDOR_IDS }) : await enumerateNodeHid({ vendorIds: FAMILY_VENDOR_IDS });
  // The Apple VID is only interesting for the AK820 receiver product.
  return groups.filter((g) => g.identity.vendorId !== 0x05ac || g.identity.productId === 0x024f);
}

export async function pickGroup(flags: GlobalFlags): Promise<HidDeviceGroup> {
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
  group: HidDeviceGroup;
}> {
  const group = await pickGroup(flags);
  const log = makeLog(flags);
  const res = await connectKeyboard(group, {
    registry: createDefaultRegistry(),
    level: flags.level ?? 'handshake',
    log,
    store: stateStore(),
    ...(flags.protocol ? { protocolId: flags.protocol } : {}),
    consent: flags.consent,
    allowExperimental: flags.experimental,
  });
  // The CLI applies the same write policy as the web app: unverified writes need --experimental.
  const driver = guardWrites(res.driver, () => ({ simulated: false, experimentalEnabled: flags.experimental }));
  return { ...res, driver, group };
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

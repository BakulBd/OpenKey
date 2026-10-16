import { runDoctor } from '@openkey/core';
import type { DoctorCheck, DoctorDevice, DoctorOs } from '@openkey/core';
import { lookupCatalogAll } from '@openkey/devices/catalog';
import { viaBoardsFor } from '@openkey/devices/via-index';
import type { HidDeviceGroup } from '@openkey/hid';

const OS: Record<string, DoctorOs> = { linux: 'linux', win32: 'windows', darwin: 'macos' };
const MARK: Record<DoctorCheck['status'], string> = {
  pass: 'ok  ',
  info: 'note',
  warn: 'warn',
  fail: 'FAIL',
};

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

/** Opens and closes the vendor interface (or the first one) to test access. Sends nothing. */
async function openError(group: HidDeviceGroup): Promise<string | null> {
  const iface =
    group.interfaces.find((i) => i.collections.some((c) => c.usagePage >= 0xff00)) ??
    group.interfaces[0];
  if (!iface) return null;
  try {
    const t = await group.openInterface(iface);
    await t.close().catch(() => undefined);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function doctorFor(group: HidDeviceGroup): Promise<DoctorDevice> {
  return {
    ...group.identity,
    interfaces: group.interfaces.map((i) =>
      i.collections.map((c) => ({
        usagePage: c.usagePage,
        usage: c.usage,
        featureReports: c.featureReports.length,
        outputReports: c.outputReports.length,
      })),
    ),
    openError: await openError(group),
    known: lookupCatalogAll(group.identity).map((e) => ({
      model: `${e.brand} ${e.model}`,
      link: e.link,
      family: e.family,
    })),
    viaNames: viaBoardsFor(group.identity.vendorId, group.identity.productId).map((b) => b.name),
  };
}

export async function doctorReport(groups: HidDeviceGroup[]) {
  const os = OS[process.platform] ?? 'other';
  const devices = [];
  for (const g of groups) {
    const device = await doctorFor(g);
    devices.push({ key: g.key, device, checks: runDoctor({ runtime: 'cli', os, device }) });
  }
  return { os, devices };
}

export function formatDoctor(r: Awaited<ReturnType<typeof doctorReport>>): string {
  if (!r.devices.length)
    return [
      'No keyboard with a known vendor ID or a VIA raw HID page was found.',
      'Check the USB cable (some only charge) and switch the keyboard to wired mode.',
      'openkey inspect --all lists every HID device on this computer.',
    ].join('\n');
  return r.devices
    .map(({ device: d, checks }) =>
      [
        `${d.productName || '(unnamed)'}  ${hex4(d.vendorId)}:${hex4(d.productId)}`,
        ...checks.map((c) =>
          [
            `  [${MARK[c.status]}] ${c.title}`,
            ...(c.detail ? [`         ${c.detail}`] : []),
            ...(c.fix ? [`         Fix: ${c.fix}`] : []),
          ].join('\n'),
        ),
      ].join('\n'),
    )
    .join('\n\n');
}

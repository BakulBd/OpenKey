import type { DoctorDevice } from '@openkey/core';
import { lookupCatalogAll } from '@openkey/devices/catalog';
import type { HidDeviceGroup } from '@openkey/hid';

/** Errors that mean "could not open the device", as opposed to a protocol answer. */
const OPEN_FAILURE = /cannot open|failed to open|permission|denied|not ?allowed|EACCES/i;

export function isAccessFailure(code: unknown, message: string): boolean {
  return (code === 'PERMISSION' || code === 'TRANSPORT') && OPEN_FAILURE.test(message);
}

/**
 * Opens and closes the device's first vendor interface (or its first interface) without sending a
 * report. Returns the error message when the OS refuses access, null otherwise.
 */
export async function openDenied(group: HidDeviceGroup): Promise<string | null> {
  const iface =
    group.interfaces.find((i) => i.collections.some((c) => c.usagePage >= 0xff00)) ??
    group.interfaces[0];
  if (!iface) return null;
  try {
    const t = await group.openInterface(iface);
    await t.close().catch(() => undefined);
    return null;
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    const message = e instanceof Error ? e.message : String(e);
    return isAccessFailure(code, message) ? message : null;
  }
}

/** The facts the connection doctor needs about one device. */
export function doctorDevice(group: HidDeviceGroup, openError?: string | null): DoctorDevice {
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
    ...(openError !== undefined ? { openError } : {}),
    known: lookupCatalogAll(group.identity).map((e) => ({
      model: `${e.brand} ${e.model}`,
      link: e.link,
      family: e.family,
    })),
  };
}

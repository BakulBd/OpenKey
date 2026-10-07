import { maxReportSize } from '@openkey/hid';
import type { HidCollection, HidDeviceGroup, HidInterfaceInfo } from '@openkey/hid';
import { CONFIG_USAGE_PAGES } from './constants.js';

/** Largest command frame OpenKey will send to an AA/55 command pipe. */
export const MAX_COMMAND_PACKET = 64;

/**
 * A command pipe: one of the official usage pages with a small output report and an input report.
 * FF60:0061 is excluded (QMK/VIA raw HID uses it), and so are 4096-byte data pipes such as the
 * AK820 MAX's FF68, which the official online driver has no configuration for.
 */
export function isAa55CommandCollection(c: HidCollection): boolean {
  if (!CONFIG_USAGE_PAGES.includes(c.usagePage)) return false;
  if (c.usagePage === 0xff60 && c.usage === 0x61) return false;
  const out = maxReportSize(c.outputReports);
  return out > 8 && out <= MAX_COMMAND_PACKET && maxReportSize(c.inputReports) > 8;
}

export function configInterface(group: HidDeviceGroup): HidInterfaceInfo | undefined {
  // The official driver uses collections[0] of the chosen HIDDevice.
  return group.interfaces.find(
    (i) => i.collections[0] && isAa55CommandCollection(i.collections[0]),
  );
}

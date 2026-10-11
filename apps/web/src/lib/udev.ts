import RULE from '../../../../udev/70-openkey.rules?raw';

const hex4 = (n: number): string => n.toString(16).padStart(4, '0');

/** USB IDs the shipped Linux rule grants access to, read from the rule file itself. */
export const RULE_IDS: ReadonlySet<string> = new Set(
  [...RULE.matchAll(/ATTRS\{idVendor\}=="([0-9a-f]{4})", ATTRS\{idProduct\}=="([0-9a-f]{4})"/g)].map((m) => `${m[1]}:${m[2]}`),
);

export const usbId = (vendorId: number, productId: number): string => `${hex4(vendorId)}:${hex4(productId)}`;

/** True when the shipped rule already covers this keyboard; otherwise the installer needs `--device`. */
export function ruleCovers(vendorId: number, productId: number): boolean {
  return RULE_IDS.has(usbId(vendorId, productId));
}

/**
 * One terminal command that downloads the installer from this site and runs it with administrator
 * rights. It is shown for the user to copy; the page never runs anything.
 */
export function installCommand(installerUrl: string, device?: { vendorId: number; productId: number }): string {
  const extra = device && !ruleCovers(device.vendorId, device.productId) ? ` --device ${usbId(device.vendorId, device.productId)}` : '';
  return `curl -fsSL ${installerUrl} -o /tmp/openkey-udev.sh && sudo sh /tmp/openkey-udev.sh${extra}`;
}

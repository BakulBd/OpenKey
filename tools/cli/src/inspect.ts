import { formatBcd, hex16 } from '@openkey/core';
import { describeCollections, parseReportDescriptor } from '@openkey/hid';
import { scanHidraw } from '@openkey/hid-node';
import { FAMILY_VENDOR_IDS } from './context.js';

/** Text dump of every AK820-family hidraw node (shared by `diagnostics` and the device inspector). */
export async function inspectText(all = false): Promise<string> {
  const nodes = (await scanHidraw()).filter((n) => all || FAMILY_VENDOR_IDS.includes(n.vendorId));
  if (!nodes.length) return 'No matching hidraw nodes.';
  const L: string[] = [];
  let lastUsb = '';
  for (const n of nodes) {
    const usb = n.usbDevice;
    if (usb && usb.sysPath !== lastUsb) {
      lastUsb = usb.sysPath;
      L.push(
        `USB ${hex16(usb.idVendor)}:${hex16(usb.idProduct)} "${usb.manufacturer ?? ''}" "${usb.product ?? ''}" serial="${usb.serial ?? ''}" bcdDevice=${formatBcd(usb.bcdDevice)} bus ${usb.busnum} dev ${usb.devnum} speed ${usb.speed ?? '?'}Mb/s`,
      );
      L.push(`  sysfs: ${usb.sysPath}`);
    } else if (!usb) {
      L.push(
        `HID bus 0x${n.bus.toString(16)} ${hex16(n.vendorId)}:${hex16(n.productId)} "${n.hidName}" phys=${n.hidPhys} uniq=${n.hidUniq}`,
      );
    }
    L.push(
      `  ${n.node}  interface ${n.interfaceNumber ?? '-'}  access r=${n.accessible.read ? 'y' : 'n'} w=${n.accessible.write ? 'y' : 'n'}`,
    );
    for (const ep of n.endpoints)
      L.push(
        `    endpoint 0x${ep.address.toString(16).padStart(2, '0')} ${ep.direction.toUpperCase()} ${ep.transferType} ${ep.maxPacketSize}B interval ${ep.interval}`,
      );
    for (const d of describeCollections(parseReportDescriptor(n.descriptor))) L.push(`    ${d}`);
    L.push(
      `    descriptor (${n.descriptor.length} B): ${Array.from(n.descriptor, (b) => b.toString(16).padStart(2, '0')).join(' ')}`,
    );
  }
  return L.join('\n');
}

import { execFileSync } from 'node:child_process';
import { formatBcd, hex16 } from '@openkey/core';
import { describeCollections, parseReportDescriptor } from '@openkey/hid';
import { scanHidraw } from '@openkey/hid-node';

if (process.platform !== 'linux') {
  console.error('This tool reads Linux sysfs. On macOS and Windows use "pnpm openkey list" / "pnpm openkey detect" instead.');
  process.exit(1);
}

/**
 * Linux hardware inspector: sysfs + hidraw descriptors (+ `lsusb -v` when available). Read-only and
 * needs no permissions. The browser equivalent is the Diagnostics page of the web app.
 *   pnpm inspect [--all] [--json] [--lsusb]
 */
const args = new Set(process.argv.slice(2));
const FAMILY = [0x0c45, 0x1a2c, 0x05ac];
const nodes = (await scanHidraw()).filter((n) => args.has('--all') || FAMILY.includes(n.vendorId));

if (args.has('--json')) {
  console.log(
    JSON.stringify(
      nodes.map((n) => ({
        ...n,
        descriptor: Array.from(n.descriptor, (b) => b.toString(16).padStart(2, '0')).join(' '),
        collections: parseReportDescriptor(n.descriptor),
      })),
      null,
      2,
    ),
  );
  process.exit(0);
}

const transportCandidates = (cols: ReturnType<typeof parseReportDescriptor>): string[] =>
  cols.flatMap((c) => {
    const out: string[] = [];
    if (c.usagePage < 0xff00) return out;
    const page = c.usagePage.toString(16).toUpperCase();
    for (const r of c.featureReports)
      out.push(`feature reports on ${page} (id ${r.reportId}, ${r.size} B)`);
    for (const r of c.outputReports)
      out.push(
        `output reports on ${page} (id ${r.reportId}, ${r.size} B)${r.size >= 1024 ? ' – bulk data pipe' : ''}`,
      );
    for (const r of c.inputReports)
      out.push(`input reports on ${page} (id ${r.reportId}, ${r.size} B)`);
    return out;
  });

let lastUsb = '';
for (const n of nodes) {
  const u = n.usbDevice;
  if (u && u.sysPath !== lastUsb) {
    lastUsb = u.sysPath;
    console.log(`\nUSB device ${hex16(u.idVendor)}:${hex16(u.idProduct)}`);
    console.log(
      `  manufacturer: ${u.manufacturer ?? '-'}\n  product:      ${u.product ?? '-'}\n  serial:       ${u.serial ?? '(none)'}\n  bcdDevice:    ${formatBcd(u.bcdDevice)}\n  bus/address:  ${u.busnum}/${u.devnum}  speed ${u.speed ?? '?'} Mb/s\n  sysfs:        ${u.sysPath}`,
    );
    if (args.has('--lsusb')) {
      try {
        console.log(
          execFileSync(
            'lsusb',
            [
              '-v',
              '-d',
              `${u.idVendor.toString(16).padStart(4, '0')}:${u.idProduct.toString(16).padStart(4, '0')}`,
            ],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
          ),
        );
      } catch {
        console.log('  (lsusb -v unavailable)');
      }
    }
  } else if (!u) {
    console.log(
      `\nHID device on bus 0x${n.bus.toString(16)} ${hex16(n.vendorId)}:${hex16(n.productId)} "${n.hidName}" (${n.bus === 5 ? 'Bluetooth' : 'non-USB'})`,
    );
  }
  const cols = parseReportDescriptor(n.descriptor);
  console.log(
    `  ${n.node}  interface ${n.interfaceNumber ?? '-'}  class ${n.interfaceClass ? `${n.interfaceClass.cls}/${n.interfaceClass.subclass}/${n.interfaceClass.protocol}` : '-'}  access ${n.accessible.read && n.accessible.write ? 'read/write' : 'NO (install udev rule)'}`,
  );
  for (const ep of n.endpoints)
    console.log(
      `    endpoint 0x${ep.address.toString(16).padStart(2, '0')} ${ep.direction.toUpperCase().padEnd(3)} ${ep.transferType} ${ep.maxPacketSize} B, interval ${ep.interval}`,
    );
  for (const d of describeCollections(cols)) console.log(`    ${d}`);
  for (const t of transportCandidates(cols)) console.log(`    transport candidate: ${t}`);
}
if (!nodes.length)
  console.log('No AK820-family HID devices found (use --all to list every HID node).');

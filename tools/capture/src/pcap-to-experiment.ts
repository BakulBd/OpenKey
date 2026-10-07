import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { EXPERIMENTS } from './experiments.js';
import type { ExperimentRecord } from './experiments.js';

/**
 * Converts a usbmon/USBPcap capture into an OpenKey experiment record using tshark field
 * extraction. HID class requests are decoded from the setup packet:
 *   bmRequestType 0x21 bRequest 0x09 (SET_REPORT), 0xA1 0x01 (GET_REPORT); wValue high byte = report type
 *   (1 input, 2 output, 3 feature), low byte = report ID; wIndex = interface.
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: 'string' },
    out: { type: 'string' },
    address: { type: 'string' },
    before: { type: 'string', default: '' },
    after: { type: 'string', default: '' },
    effect: { type: 'string', default: '' },
    tool: { type: 'string', default: 'official AJAZZ driver' },
  },
});
const file = positionals[0];
if (!file) {
  console.error(
    'usage: tsx tools/capture/src/pcap-to-experiment.ts <capture.pcapng> --id 03-rgb-red-blue [--address N] [--out file.json]',
  );
  process.exit(2);
}

const fields = [
  'frame.time_relative',
  'usb.device_address',
  'usb.endpoint_address',
  'usb.transfer_type',
  'usb.urb_type',
  'usb.bmRequestType',
  'usb.setup.bRequest',
  'usb.setup.wValue',
  'usb.setup.wIndex',
  'usb.data_fragment',
  'usbhid.data',
  'usb.capdata',
];
const tsv = execFileSync(
  'tshark',
  ['-r', file, '-T', 'fields', '-E', 'separator=\t', ...fields.flatMap((f) => ['-e', f])],
  { encoding: 'utf8', maxBuffer: 1 << 30 },
);

const packets: ExperimentRecord['packets'] = [];
const pendingSetup = new Map<
  string,
  { kind: ExperimentRecord['packets'][number]['kind']; reportId: number; iface: number }
>();
for (const line of tsv.split('\n')) {
  if (!line.trim()) continue;
  const [t, addr, ep, xfer, urb, reqType, bReq, wValue, wIndex, frag, hid, cap] = line.split('\t');
  if (values.address && addr !== values.address) continue;
  const data = (frag || hid || cap || '').replace(/:/g, '');
  const epNum = parseInt(ep ?? '0', 16);
  const isIn = (epNum & 0x80) !== 0;
  if (xfer === '0x02' || xfer === '2') {
    // Control transfer: setup stage carries the class request; data travels in the same (out) or completion (in) URB.
    if (reqType) {
      const wv = parseInt(wValue ?? '0', 16);
      const type = (wv >> 8) & 0xff;
      const kind =
        bReq === '0x09' || bReq === '9'
          ? type === 3
            ? 'feature-set'
            : 'output'
          : type === 3
            ? 'feature-get'
            : 'input';
      const key = `${addr}`;
      if (kind === 'feature-set' || kind === 'output') {
        if (data)
          packets.push({
            t: Number(t),
            direction: 'host->device',
            kind,
            interface: parseInt(wIndex ?? '0', 16),
            reportId: wv & 0xff,
            hex: data.match(/../g)!.join(' '),
          });
      } else
        pendingSetup.set(key, { kind, reportId: wv & 0xff, iface: parseInt(wIndex ?? '0', 16) });
    } else if (data && urb === "'C'" && pendingSetup.has(`${addr}`)) {
      const s = pendingSetup.get(`${addr}`)!;
      pendingSetup.delete(`${addr}`);
      packets.push({
        t: Number(t),
        direction: 'device->host',
        kind: s.kind,
        interface: s.iface,
        reportId: s.reportId,
        hex: data.match(/../g)!.join(' '),
      });
    }
  } else if (data) {
    packets.push({
      t: Number(t),
      direction: isIn ? 'device->host' : 'host->device',
      kind: isIn ? 'input' : 'output',
      endpoint: `0x${epNum.toString(16).padStart(2, '0')}`,
      reportId: 0,
      hex: data.match(/../g)!.join(' '),
    });
  }
}

const id = values.id ?? 'unnamed';
const record: ExperimentRecord = {
  experiment: id,
  description: EXPERIMENTS.find(([x]) => x === id)?.[1] ?? '',
  timestamp: new Date().toISOString(),
  device: { vendorId: '?', productId: '?' },
  host: { os: `${os.type()} ${os.release()}`, tool: values.tool! },
  beforeState: values.before!,
  afterState: values.after!,
  observedEffect: values.effect!,
  packets,
};
const out = values.out ?? file.replace(/\.pcapng?$/, '.json');
await fs.writeFile(out, `${JSON.stringify(record, null, 1)}\n`);
console.log(`${packets.length} HID packets → ${out}`);

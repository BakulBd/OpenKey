import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MemoryStateStore, PacketLog, explainError, formatBcd, hex16 } from '@openkey/core';
import { enumerateLinux } from '@openkey/hid-node';
import {
  connectKeyboard,
  createDefaultRegistry,
  formatDetectionReport,
} from '@openkey/protocols';
import type { ProbeLevel } from '@openkey/protocols';

if (process.platform !== 'linux') {
  console.error('This tool reads Linux sysfs. On macOS and Windows use "pnpm openkey list" / "pnpm openkey detect" instead.');
  process.exit(1);
}

/**
 * First-contact probe: detect → device info → save a fixture with every raw packet.
 *   pnpm probe [--level passive|handshake] [--fixture fixtures/device-info/x.json]
 * Only read-only/handshake commands are sent.
 */
const { values } = parseArgs({
  options: {
    level: { type: 'string', default: 'handshake' },
    fixture: { type: 'string' },
    device: { type: 'string' },
  },
});

try {
  const groups = await enumerateLinux({ vendorIds: [0x0c45, 0x1a2c, 0x05ac] });
  const group = values.device ? groups[Number(values.device)] : groups[0];
  if (!group) throw new Error('No AK820-family keyboard found.');
  const log = new PacketLog();
  const { driver, detection } = await connectKeyboard(group, {
    registry: createDefaultRegistry(),
    level: values.level as ProbeLevel,
    log,
    store: new MemoryStateStore(),
  });
  const info = await driver.getDeviceInfo();
  await driver.disconnect();
  console.log(formatDetectionReport(detection, true));
  console.log(
    `\nDetected device:\n  ${info.model}\nVID/PID:\n  ${hex16(info.identity.vendorId)}:${hex16(info.identity.productId)}\nFirmware:\n  ${info.firmware.version ?? 'unknown'} (${info.firmware.source})\nProtocol:\n  ${info.protocol.name}\nTransport:\n  ${info.transport}\nConfidence:\n  ${detection.selected?.confidence}`,
  );
  const date = new Date().toISOString().slice(0, 10);
  const file =
    values.fixture ??
    path.join(
      'fixtures',
      'device-info',
      `${info.profileId}-${info.transport}-${info.identity.release !== undefined ? formatBcd(info.identity.release) : 'fw'}-probe-${date}.json`,
    );
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    `${JSON.stringify(
      {
        description: `openkey probe (${values.level}) on ${info.model}`,
        date,
        device: info.model,
        firmware: info.firmware,
        transport: info.transport,
        identity: info.identity,
        detection,
        packets: log.toJSON(),
        confidence: detection.selected?.confidence,
        source: 'hardware',
      },
      null,
      1,
    )}\n`,
  );
  console.log(`\nFixture written: ${file}`);
} catch (e) {
  const x = explainError(e);
  console.error(`${x.title}: ${x.detail}${x.hint ? `\nHint: ${x.hint}` : ''}`);
  process.exit(1);
}

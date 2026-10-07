import { Evidence, hex16, toHex } from '@openkey/core';
import { findInterface, maxReportSize } from '@openkey/hid';
import type { HidDeviceGroup } from '@openkey/hid';
import type {
  CandidateMatch,
  ProbeContext,
  ProbeResult,
  ProtocolDefinition,
} from '../../registry.js';
import { Cmd, DEVICE_INFO_BYTES, TFT_USAGE_PAGE } from './constants.js';
import { decodeDeviceInfo } from './codecs.js';
import { SONIX_AA55_PROTOCOL_ID, SonixAa55Driver } from './driver.js';
import { MAX_COMMAND_PACKET, configInterface } from './match.js';
import { Aa55Link } from './transfer.js';

function match(group: HidDeviceGroup): CandidateMatch {
  const reasons: string[] = [];
  const rejections: string[] = [];
  const iface = configInterface(group);
  let score = 0;
  if (iface) {
    const c = iface.collections[0]!;
    score += 60;
    reasons.push(
      `command collection ${c.usagePage.toString(16).toUpperCase()}:${c.usage.toString(16)} with ${maxReportSize(c.outputReports)}-byte output report`,
    );
  } else {
    const big = group.interfaces.flatMap((i) => i.collections).find((c) => c.usagePage === 0xff68);
    rejections.push(
      big
        ? `FF68 output report is ${maxReportSize(big.outputReports)} bytes: a bulk data pipe, not an AA/55 command pipe (limit ${MAX_COMMAND_PACKET})`
        : 'no online-driver command collection (FF68/FF80/FF00/FF01/FF1B)',
    );
  }
  if (findInterface(group, (c) => c.usagePage === TFT_USAGE_PAGE)) {
    score += 20;
    reasons.push('FF67 TFT data pipe present');
  }
  if (group.identity.vendorId === 0x0c45) score += 5;
  return { applicable: !!iface, score, reasons, rejections };
}

async function probe(ctx: ProbeContext): Promise<ProbeResult> {
  if (ctx.level === 'passive') {
    return {
      status: 'skipped',
      confidence: Evidence.INFERRED,
      summary: 'This protocol has no passive read; descriptor signature only.',
      steps: [],
      facts: {},
    };
  }
  const iface = configInterface(ctx.group)!;
  const link = new Aa55Link(await ctx.open(iface));
  const raw = await link.read(Cmd.GET_DEVICE_INFO, DEVICE_INFO_BYTES, { maxRetries: 1 });
  const info = decodeDeviceInfo(raw);
  const idMatches =
    info.vid === ctx.group.identity.vendorId && info.pid === ctx.group.identity.productId;
  return {
    status: idMatches ? 'pass' : 'fail',
    confidence: idMatches ? Evidence.VERIFIED : Evidence.INFERRED,
    summary: idMatches
      ? `GET_DEVICE_INFO answered; firmware ${info.version}, VID/PID fields match USB identity.`
      : `GET_DEVICE_INFO answered but VID/PID fields (${hex16(info.vid)}:${hex16(info.pid)}) differ from USB identity.`,
    steps: [
      {
        name: 'GET_DEVICE_INFO (0x10, 48 bytes)',
        status: idMatches ? 'pass' : 'fail',
        detail: `firmware ${info.version}, battery ${info.batteryLevel}%`,
        raw: toHex(raw),
      },
    ],
    facts: { deviceInfo: info },
  };
}

export const sonixAa55Protocol: ProtocolDefinition = {
  id: SONIX_AA55_PROTOCOL_ID,
  manifest: {
    version: '1.0.0',
    status: 'community',
    transports: { input: ['usb', '2.4ghz', 'bluetooth'], configuration: ['usb'] },
    verification: 'Simulator-tested only; never run on hardware by OpenKey.',
    safety: 'Writes need the experimental opt-in.',
    provenance: [
      { source: 'official-driver', reference: 'AJAZZ online driver bundle 2026-09-11', status: Evidence.OBSERVED },
      { source: 'public-reverse-engineering', reference: 'wsclx/ak820pro-modder', status: Evidence.INFERRED },
    ],
  },
  name: 'AJAZZ online-driver protocol (AA/55 output reports)',
  family: 'sonix-aa55',
  priority: 40,
  supportedDevices:
    'AK820 Pro units supported by ajazz.driveall.cn (product "AK820", FF68 64-byte command pipe, FF67 TFT pipe)',
  supportedFirmware: 'Online driver frameVersion 0/1',
  requiredUsagePages: [0xff68],
  requiredReports: ['FF68 (or FF80/FF00/FF01/FF1B) output ≤64B + input', 'FF67 output 4104B (TFT)'],
  evidence: [
    'AJAZZ online driver bundle (functions ht, ya, hd, _n, Sn, Bd, Fn, zd, Ln, jd, Rn, ek, ik, rk)',
    'wsclx/ak820pro-modder hardware notes',
  ],
  match,
  probe,
  async createDriver(group, opts) {
    return new SonixAa55Driver(group, opts);
  },
};

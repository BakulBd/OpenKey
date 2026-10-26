import { Evidence, toHex } from '@openkey/core';
import { LoggingTransport } from '@openkey/hid';
import type { HidCollection, HidDeviceGroup, HidInterfaceInfo } from '@openkey/hid';
import type {
  CandidateMatch,
  ProbeContext,
  ProbeResult,
  ProtocolDefinition,
} from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';
import { Cmd, REPORT_BYTES, ROYUAN_PROTOCOL_ID, USAGES, USAGE_PAGE } from './constants.js';
import { RoyuanDriver, RoyuanSession, deviceIdOf } from './driver.js';

const isChannel = (c: HidCollection) =>
  c.usagePage === USAGE_PAGE &&
  (USAGES as readonly number[]).includes(c.usage) &&
  c.featureReports.some((r) => r.reportId === 0 && r.size === REPORT_BYTES);

export function findChannel(g: HidDeviceGroup): HidInterfaceInfo | undefined {
  return g.interfaces.find((i) => i.collections.some(isChannel));
}

export const royuanProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: ROYUAN_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb', '2.4ghz', 'bluetooth'], configuration: ['usb'] },
    verification:
      'Identification and lighting implemented from sharkfin’s hardware-tested protocol notes; not yet run by OpenKey on a ROYUAN board.',
    safety:
      'Identification is two reads (asked first). Lighting is written in both command sets; key maps on yc500 (single-slot writes) and gen2 (whole layer, as RK’s own web driver writes it); every write is read back. Reset, erase and boot opcodes are refused by the packet builder.',
    provenance: [
      {
        source: 'public-reverse-engineering',
        reference:
          'github.com/dniminenn/sharkfin docs/PROTOCOL.md (GPL-3.0; facts only, [HW]-marked sections)',
        status: Evidence.INFERRED,
      },
      {
        source: 'official-driver',
        reference:
          'RK web driver drive.rkgaming.com, ROYUAN (RongYuan) module (facts only): gen2 opcodes, key-map write 0x0A, checksum, key-code encoding with modifier combinations',
        status: Evidence.INFERRED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Lighting and the base key map (plus the Fn layer on yc500). Macros, sleep, debounce and the screen are not written: their opcodes differ between the command sets, and RK’s web driver gives gen2 report-rate and profile writes the same opcode.',
      'Some boards swap “fixed colour” and “rainbow”, and a few have wider brightness or speed ranges.',
      'USB cable only; the 2.4 GHz receiver relays packets with its own protocol.',
      'The keyboard picture is a generic 75 % layout; models are named by the USB product string.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'ROYUAN protocol (Akko, MonsGeek, ABKO, magnetic AJAZZ AK820 with screen …)',
  family: ROYUAN_PROTOCOL_ID,
  priority: 45,
  supportedDevices:
    'Keyboards with the ROYUAN vendor collection FFFF:0002 / FFFF:0001 and a 64-byte feature report, mostly USB VID 3151',
  supportedFirmware: 'yc500 and gen2 command sets (identification, lighting)',
  requiredUsagePages: [USAGE_PAGE],
  requiredReports: ['FFFF:0002 feature id0 64B'],
  evidence: ['dniminenn/sharkfin docs/PROTOCOL.md'],
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'feature-set',
        collection: 'FFFF:0002',
        reportId: 0,
        payloadPrefix: '8F',
        purpose: 'Identify: asks for the vendor model record; a read.',
        effect: 'none',
        evidence: Evidence.INFERRED,
      },
      {
        level: 'handshake',
        op: 'feature-get',
        collection: 'FFFF:0002',
        reportId: 0,
        payloadPrefix: '',
        purpose: 'Reply: 8F, record number (u32 LE).',
        effect: 'none',
        evidence: Evidence.INFERRED,
      },
    ],
    autoConsent: () => ({
      auto: false,
      reason: 'one read request (identify 0x8F); asked first until verified on hardware',
    }),
  },
  match(group): CandidateMatch {
    const ch = findChannel(group);
    if (!ch)
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['no FFFF:0001/0002 collection with a 64-byte feature report'],
      };
    const reasons = [
      'vendor collection FFFF:0002 (or 0001) with a 64-byte feature report (ROYUAN)',
    ];
    let score = 35;
    if (group.identity.vendorId === 0x3151) {
      score += 5;
      reasons.push('vendor ID 3151 (common for ROYUAN boards, not proof)');
    }
    return { applicable: true, score, reasons, rejections: [] };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const ch = findChannel(ctx.group);
    if (!ch)
      return {
        status: 'fail',
        confidence: Evidence.HYPOTHESIS,
        summary: 'Channel missing',
        steps: [],
        facts: {},
      };
    if (ctx.level !== 'handshake')
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
        summary: 'Descriptor signature only.',
        steps: [],
        facts: {},
      };
    const s = new RoyuanSession(await ctx.open(ch));
    const r = await s.query([Cmd.IDENTIFY]).catch(() => null);
    const id = r ? deviceIdOf(r) : 0;
    const ok = !!r && id !== 0;
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.OBSERVED : Evidence.HYPOTHESIS,
      summary: ok ? `ROYUAN identify answered: device record ${id}` : 'No ROYUAN identify answer',
      steps: [
        {
          name: 'identify (8F)',
          status: ok ? 'pass' : 'fail',
          detail: ok ? `record ${id}` : 'no answer or an echo of the request',
          ...(r ? { raw: toHex(r.subarray(0, 12)) } : {}),
        },
      ],
      facts: { deviceId: id },
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const ch = findChannel(group);
    if (!ch) throw new Error('ROYUAN channel missing');
    return new RoyuanDriver(group, ch, Number(opts.probe?.facts.deviceId ?? 0), {
      open: async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
      ...(opts.cmdDelayMs !== undefined ? { delayMs: opts.cmdDelayMs } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    });
  },
};

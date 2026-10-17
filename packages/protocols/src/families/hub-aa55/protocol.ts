import { Evidence } from '@openkey/core';
import { LoggingTransport } from '@openkey/hid';
import type { HidCollection, HidDeviceGroupInfo, HidInterfaceInfo } from '@openkey/hid';
import type {
  CandidateMatch,
  ProbeContext,
  ProbeResult,
  ProtocolDefinition,
} from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';
import { Cmd, HUB_PROTOCOL_ID, decodeInfo } from './codec.js';
import { HubDriver, HubSession } from './driver.js';
import { hubModel } from './models.js';

const PAGES = [0xff68, 0xff60];
/** Input and output reports of the same size (32 or 64 bytes) without a report ID. */
function channelSize(c: HidCollection): number | null {
  if (!PAGES.includes(c.usagePage) || c.usage !== 0x61) return null;
  const i = c.inputReports.find((r) => r.reportId === 0)?.size;
  const o = c.outputReports.find((r) => r.reportId === 0)?.size;
  return i && i === o && (i === 32 || i === 64) ? i : null;
}

export function findHubChannel(
  g: HidDeviceGroupInfo,
): { iface: HidInterfaceInfo; size: number } | undefined {
  for (const iface of g.interfaces)
    for (const c of iface.collections) {
      const size = channelSize(c);
      if (size) return { iface, size };
    }
  return undefined;
}

export const hubProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: HUB_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb', '2.4ghz', 'bluetooth'], configuration: ['usb', '2.4ghz'] },
    verification:
      'Implemented from public protocol notes verified by their authors on an AULA F87S 8K (cable and receiver) and an AJAZZ AK680 V2; tested against a simulator, not yet run by OpenKey.',
    safety:
      'Reads first and writes back only changed fields of the block it read, then reads again. Lighting is enabled only after the keyboard answers the lighting read; through a receiver, nothing is changed unless the relayed keyboard is the expected model. Firmware download, factory reset and calibration commands are refused.',
    provenance: [
      {
        source: 'public-reverse-engineering',
        reference: 'Dylan-1107/aula-f87s-hid docs/HID-PROTOCOL.md and KEY-MAPPING.md (MIT)',
        status: Evidence.OBSERVED,
      },
      {
        source: 'public-reverse-engineering',
        reference: '10ishk/ak680-studio (Apache-2.0): AK680 V2 device info and lighting packets',
        status: Evidence.INFERRED,
      },
      {
        source: 'public-reverse-engineering',
        reference: 'somenever/not-ajazz-ak680-max-webhid (GPL-3.0; facts only): AK680 MAX framing',
        status: Evidence.INFERRED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Built-in effects are listed by number: their names are not documented.',
      'Per-key colours only on models with a confirmed LED map (AULA F87S 8K).',
      'Key maps, macros and magnetic-switch settings are not written yet.',
      'Through the 2.4 GHz receiver the keyboard must be awake.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'AULA/AJAZZ web-driver protocol (AULA F87S 8K, AJAZZ AK680 V2 / MAX)',
  family: HUB_PROTOCOL_ID,
  priority: 55,
  supportedDevices:
    'AULA F87S 8K (38A6:2908, receiver 0C45:FEF9); AJAZZ AK680 V2 (0C45:80BC/80C1/80C2) and AK680 MAX RGB (0C45:80B2)',
  supportedFirmware: 'AA/55 web-driver firmware',
  requiredUsagePages: PAGES,
  requiredReports: ['FF68:0061 or FF60:0061 input + output 32/64B'],
  evidence: [
    'Dylan-1107/aula-f87s-hid',
    '10ishk/ak680-studio',
    'somenever/not-ajazz-ak680-max-webhid',
  ],
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'output',
        collection: 'FF68:0061',
        reportId: 0,
        payloadPrefix: 'AA 10',
        purpose:
          'Device-info read (cmd 0x10, zero data): read-only, the first request of every tool for these boards.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
      {
        level: 'handshake',
        op: 'input-read',
        collection: 'FF68:0061',
        reportId: 0,
        payloadPrefix: '',
        purpose:
          'The reply starts 55 10 and carries the keyboard’s own VID/PID, firmware version and battery.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
    ],
    autoConsent: (g) =>
      hubModel(g.identity.vendorId, g.identity.productId)
        ? {
            auto: true,
            reason:
              'a read-only request the public tools for this exact identity send first (verified harmless by their authors)',
          }
        : { auto: false, reason: 'not a listed AULA/AJAZZ web-driver identity' },
  },
  match(group): CandidateMatch {
    const ch = findHubChannel(group);
    const model = hubModel(group.identity.vendorId, group.identity.productId);
    if (!ch)
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['no FF68/FF60:0061 channel with 32/64-byte reports'],
      };
    if (!model)
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['USB identity not listed for this protocol'],
      };
    return {
      applicable: true,
      score: 75,
      reasons: [`${model.name}`, `${ch.size}-byte vendor channel`],
      rejections: [],
    };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const ch = findHubChannel(ctx.group);
    const model = hubModel(ctx.group.identity.vendorId, ctx.group.identity.productId);
    if (ctx.level !== 'handshake' || !ch || !model)
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
        summary: 'Descriptor signature only.',
        steps: [],
        facts: {},
      };
    const s = new HubSession(await ctx.open(ch.iface), ch.size, model.link === 'usb' ? 1000 : 2500);
    const data = await s.read(Cmd.DEVICE_INFO, model.infoBytes).catch(() => null);
    const info = data ? decodeInfo(data) : null;
    const ok = !!info && info.vendorId !== 0 && info.productId !== 0;
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.VERIFIED : Evidence.HYPOTHESIS,
      summary: ok
        ? `${model.name}: keyboard ${info!.vendorId.toString(16).padStart(4, '0')}:${info!.productId.toString(16).padStart(4, '0')}, firmware ${info!.firmware}`
        : 'No answer to the device-info read',
      steps: [
        {
          name: 'device info (AA 10)',
          status: ok ? 'pass' : 'fail',
          detail: ok ? `firmware ${info!.firmware}` : 'no answer',
        },
      ],
      facts: ok ? { body: [info!.vendorId, info!.productId], firmware: info!.firmware } : {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const ch = findHubChannel(group);
    const model = hubModel(group.identity.vendorId, group.identity.productId);
    if (!ch || !model) throw new Error('Not an AULA/AJAZZ web-driver keyboard');
    return new HubDriver(
      group,
      ch.iface,
      model,
      ch.size,
      async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
    );
  },
};

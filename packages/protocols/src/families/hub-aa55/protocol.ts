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
import { loadWebBoard, webIdentity, webModel } from './webboards.js';
import { isAa55CommandCollection } from '../sonix-aa55/match.js';

/**
 * A listed model, or a board AJAZZ's own web driver configures (name, USB identity). A board known
 * only from the web driver's list is left to the online-driver adapter (sonix-aa55) whenever that
 * adapter can drive it; the hub takes it only on a channel sonix-aa55 refuses (FF60:0061).
 */
function known(
  g: HidDeviceGroupInfo,
): { name: string; infoBytes: number; usb: boolean } | undefined {
  const { vendorId, productId, productName } = g.identity;
  const m = hubModel(vendorId, productId);
  if (m) return { name: m.name, infoBytes: m.infoBytes, usb: m.link === 'usb' };
  const w = webIdentity(vendorId, productId, productName);
  if (!w) return undefined;
  const online = g.interfaces.some(
    (i) => i.collections[0] && isAa55CommandCollection(i.collections[0]),
  );
  return online ? undefined : { name: w[2], infoBytes: 48, usb: true };
}

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
      'Reads first and writes back only changed fields of the block it read, then reads again. Lighting is enabled only after the keyboard answers the lighting read; through a receiver, nothing is changed unless the relayed keyboard is the expected model. Key tables are read, changed and written whole, then read again; the Fn key keeps its function. Firmware download, factory reset, calibration, OTA and serial-number commands are refused.',
    provenance: [
      {
        source: 'public-reverse-engineering',
        reference: 'Dylan-1107/aula-f87s-hid docs/HID-PROTOCOL.md and KEY-MAPPING.md (MIT)',
        status: Evidence.OBSERVED,
      },
      {
        source: 'official-driver',
        reference:
          'AJAZZ web driver ajazz.driveall.cn (facts only): command table, key tables 0x12/0x22 and 0x16/0x26, key-entry encoding, per-board key numbers (AK680 V2 / MAX)',
        status: Evidence.INFERRED,
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
      'Key maps, the Fn layer and macros on the F87S 8K, the AK680 and boards on FF60:0061 the web driver lists (keys, media keys, mouse buttons and wheel, macros); magnetic-switch settings are not written yet.',
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
        : known(g)
          ? {
              auto: true,
              reason:
                'a read-only request AJAZZ’s own web driver sends first to this board (listed by its identity and product name)',
            }
          : { auto: false, reason: 'not a listed AULA/AJAZZ web-driver identity' },
  },
  match(group): CandidateMatch {
    const ch = findHubChannel(group);
    const model = known(group);
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
      // A board known only from the web driver's list yields to a dedicated adapter.
      score: hubModel(group.identity.vendorId, group.identity.productId) ? 75 : 55,
      reasons: [`${model.name}`, `${ch.size}-byte vendor channel`],
      rejections: [],
    };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const ch = findHubChannel(ctx.group);
    const model = known(ctx.group);
    if (ctx.level !== 'handshake' || !ch || !model)
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
        summary: 'Descriptor signature only.',
        steps: [],
        facts: {},
      };
    const s = new HubSession(await ctx.open(ch.iface), ch.size, model.usb ? 1000 : 2500);
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
    const { vendorId, productId, productName } = group.identity;
    const id = webIdentity(vendorId, productId, productName);
    const web = !hubModel(vendorId, productId) && id ? await loadWebBoard(id) : null;
    const model = hubModel(vendorId, productId) ?? (web ? webModel(web) : undefined);
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

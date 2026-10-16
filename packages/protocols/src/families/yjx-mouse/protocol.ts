import { Evidence } from '@openkey/core';
import { LoggingTransport, findInterface } from '@openkey/hid';
import type { HidCollection, HidDeviceGroupInfo } from '@openkey/hid';
import type { ProbeContext, ProbeResult, ProtocolDefinition } from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';
import { READ_CONFIG, YJX_IDENTITIES, YJX_PROTOCOL_ID, YJX_USAGE_PAGE, answers } from './codec.js';
import { YjxMouseDriver, YjxSession } from './driver.js';

const isConfig = (c: HidCollection) => c.usagePage === YJX_USAGE_PAGE;
const known = (g: HidDeviceGroupInfo) =>
  YJX_IDENTITIES.some(
    (i) => i.vendorId === g.identity.vendorId && i.productId === g.identity.productId,
  );

export const yjxMouseProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: YJX_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb', '2.4ghz'], configuration: ['usb', '2.4ghz'] },
    verification:
      'Implemented from a public protocol reference captured from the vendor’s web configurator on one unit; tested against a simulator, not yet run by OpenKey on the mouse.',
    safety:
      'Settings are written only as read-modify-write of the block just read from the mouse, then checked against the mouse’s reply and a fresh read. Values outside the documented choices are refused.',
    provenance: [
      {
        source: 'public-reverse-engineering',
        reference: 'Ripariav/Ajazz-AJ139V2MC-Linux-Driver PROTOCOL.md and ajazz-ctl.py (MIT)',
        status: Evidence.OBSERVED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Cable and receiver keep separate settings; the link in use is the one changed.',
      'Button mapping, lighting modes and lift-off distance are not edited (their values are not fully documented).',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'AJAZZ AJ139 V2 MC mouse (YJX firmware)',
  family: 'yjx-mouse',
  priority: 50,
  supportedDevices: 'AJAZZ AJ139 V2 MC: A8A4:2255 (cable), A8A5:2255 (receiver)',
  supportedFirmware: 'YJX web-configurator protocol',
  requiredUsagePages: [YJX_USAGE_PAGE],
  requiredReports: ['FF01 output 64B'],
  evidence: ['Ripariav/Ajazz-AJ139V2MC-Linux-Driver'],
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'output',
        collection: 'FF01',
        reportId: 0,
        payloadPrefix: '55 0E A5 0B',
        purpose: 'Live settings read: read-only, sent by the vendor web configurator on page load.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
      {
        level: 'handshake',
        op: 'input-read',
        collection: 'FF01',
        reportId: 0,
        payloadPrefix: '',
        purpose: 'The reply starts aa 0e a5 and carries the settings block.',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
    ],
    autoConsent: (g) =>
      known(g)
        ? {
            auto: true,
            reason: 'the vendor web configurator sends this read to this exact identity',
          }
        : { auto: false, reason: 'not an AJ139 V2 MC identity' },
  },
  match(group) {
    const i = findInterface(group, isConfig);
    return known(group) && i
      ? {
          applicable: true,
          score: 80,
          reasons: ['AJ139 V2 MC identity', 'FF01 configuration interface'],
          rejections: [],
        }
      : {
          applicable: false,
          score: 0,
          reasons: [],
          rejections: [
            known(group) ? 'no FF01 configuration interface' : 'not an AJ139 V2 MC identity',
          ],
        };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    if (ctx.level !== 'handshake')
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
        summary: 'Descriptor signature only.',
        steps: [],
        facts: {},
      };
    const s = new YjxSession(await ctx.open(findInterface(ctx.group, isConfig)!));
    const r = await s.request(READ_CONFIG).catch(() => null);
    const ok = !!r && answers(r, READ_CONFIG);
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.VERIFIED : Evidence.HYPOTHESIS,
      summary: ok ? 'The mouse returned its settings block' : 'No answer to the settings read',
      steps: [
        {
          name: 'live settings read',
          status: ok ? 'pass' : 'fail',
          detail: ok ? 'answered' : 'no answer',
        },
      ],
      facts: {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const iface = findInterface(group, isConfig);
    if (!iface) throw new Error('FF01 configuration interface missing');
    return new YjxMouseDriver(
      group,
      iface,
      async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
    );
  },
};

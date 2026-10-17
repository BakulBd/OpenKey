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
import { RazerDriver, RazerSession, firmwareCmd } from './driver.js';
import { RAZER_MODELS, RAZER_PROTOCOL_ID, REPORT_BYTES, razerModel } from './models.js';

/** The control collection: a 90-byte feature report without a report ID (not the boot keyboard). */
const isControl = (c: HidCollection) =>
  !(c.usagePage === 0x01 && c.usage === 0x06) &&
  c.featureReports.some((r) => r.reportId === 0 && r.size === REPORT_BYTES);
const control = (g: HidDeviceGroupInfo): HidInterfaceInfo | undefined =>
  g.interfaces.find((i) => i.collections.some(isControl));

export const razerProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: RAZER_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb', '2.4ghz', 'bluetooth'], configuration: ['usb', '2.4ghz'] },
    verification:
      'Implemented from openrazer and OpenRGB, which their users run on these keyboards; tested against a simulator, not yet run by OpenKey on a Razer keyboard.',
    safety:
      'Lighting commands only. Each command waits for the keyboard’s “done”; brightness is read back. Device-mode, firmware and profile commands are never sent.',
    provenance: [
      {
        source: 'public-reverse-engineering',
        reference:
          'openrazer driver/razercommon.c, razerchromacommon.c, razerkbd_driver.c (GPL-2.0; facts only)',
        status: Evidence.INFERRED,
      },
      {
        source: 'public-reverse-engineering',
        reference:
          'OpenRGB Controllers/RazerController (GPL-2.0; facts only): model table, command sets, transaction ids',
        status: Evidence.INFERRED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Lighting only: Razer key maps, macros and on-board profiles are not public.',
      'The effect cannot be read back from the keyboard; OpenKey shows what it last set (brightness is read).',
      'Per-key colours are set on the LED matrix grid (row · column), not on key labels, and last until another effect is chosen.',
      'Synapse may overwrite OpenKey’s lighting while it runs; quit it first.',
      'Bluetooth links have no settings channel.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'Razer Chroma keyboards (BlackWidow, Huntsman, Ornata, Cynosa, DeathStalker …)',
  family: RAZER_PROTOCOL_ID,
  priority: 50,
  supportedDevices: `${RAZER_MODELS.length} Razer keyboards and keypads (VID 1532), from OpenRGB’s table`,
  supportedFirmware: 'Razer Chroma keyboard firmware',
  requiredUsagePages: [],
  requiredReports: ['feature id 0 90B'],
  evidence: ['openrazer', 'OpenRGB RazerController'],
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'feature-set',
        collection: '0001:0002',
        reportId: 0,
        payloadPrefix: '00',
        purpose:
          'Firmware version read (class 00, command 81): read-only; Synapse, openrazer and OpenRGB send it first.',
        effect: 'none',
        evidence: Evidence.INFERRED,
      },
      {
        level: 'handshake',
        op: 'feature-get',
        collection: '0001:0002',
        reportId: 0,
        payloadPrefix: '',
        purpose: 'The answer has status 02 and echoes class 00 / command 81 with the version.',
        effect: 'none',
        evidence: Evidence.INFERRED,
      },
    ],
    autoConsent: (g) =>
      razerModel(g.identity.vendorId, g.identity.productId)
        ? {
            auto: true,
            reason: 'Razer’s own software reads the firmware version of this exact identity',
          }
        : { auto: false, reason: 'not a listed Razer keyboard' },
  },
  match(group): CandidateMatch {
    const model = razerModel(group.identity.vendorId, group.identity.productId);
    const ch = control(group);
    if (!model)
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['not a listed Razer keyboard'],
      };
    if (!ch)
      return {
        applicable: false,
        score: 0,
        reasons: [model.name],
        rejections: [
          'no 90-byte feature report (control collection not exposed on this link or platform)',
        ],
      };
    return {
      applicable: true,
      score: 80,
      reasons: [model.name, '90-byte control feature report'],
      rejections: [],
    };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const model = razerModel(ctx.group.identity.vendorId, ctx.group.identity.productId);
    const ch = control(ctx.group);
    if (ctx.level !== 'handshake' || !model || !ch)
      return {
        status: 'skipped',
        confidence: Evidence.INFERRED,
        summary: 'Descriptor signature only.',
        steps: [],
        facts: {},
      };
    const s = new RazerSession(await ctx.open(ch), model.transactionId);
    const r = await s.run(firmwareCmd).catch(() => null);
    const ok = !!r;
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.VERIFIED : Evidence.HYPOTHESIS,
      summary: ok ? `${model.name}, firmware ${r![8]}.${r![9]}` : 'No answer to the firmware read',
      steps: [
        {
          name: 'firmware version (00 81)',
          status: ok ? 'pass' : 'fail',
          detail: ok ? `${r![8]}.${r![9]}` : 'no answer',
        },
      ],
      facts: ok ? { model: model.name } : {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const model = razerModel(group.identity.vendorId, group.identity.productId);
    const ch = control(group);
    if (!model || !ch) throw new Error('Not a listed Razer keyboard');
    return new RazerDriver(group, ch, model, {
      store: opts.store,
      open: async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    });
  },
};

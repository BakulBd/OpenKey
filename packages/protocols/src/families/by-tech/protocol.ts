import { Evidence, toHex } from '@openkey/core';
import { LoggingTransport } from '@openkey/hid';
import type { HidCollection, HidDeviceGroup, HidInterfaceInfo } from '@openkey/hid';
import type { CandidateMatch, ProbeContext, ProbeOperation, ProbeResult, ProbeStep, ProtocolDefinition } from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';
import { BY_TECH_PROTOCOL_ID, REPORT_BYTES, REPORT_IDS, SINOWEALTH_VID } from './constants.js';
import { ByTechDriver } from './driver.js';
import { identityHex, modelFor } from './models.js';
import { ByTechSession } from './session.js';

const commandReport = (c: HidCollection): number | undefined =>
  c.featureReports.find((r) => (REPORT_IDS as readonly number[]).includes(r.reportId) && r.size === REPORT_BYTES)?.reportId;

/** The interface and report ID of the command channel, from descriptors alone. */
export function findCommandChannel(group: HidDeviceGroup): { iface: HidInterfaceInfo; reportId: number } | undefined {
  for (const iface of group.interfaces)
    for (const c of iface.collections) {
      const reportId = commandReport(c);
      if (reportId !== undefined) return { iface, reportId };
    }
  return undefined;
}

function match(group: HidDeviceGroup): CandidateMatch {
  const ch = findCommandChannel(group);
  if (!ch)
    return { applicable: false, score: 0, reasons: [], rejections: [`no feature report 6 or 9 of ${REPORT_BYTES} bytes (BY Tech command channel)`] };
  const reasons = [`feature report ${ch.reportId} of ${REPORT_BYTES} bytes (BY Tech OEM command channel: AULA F75/F99, RK R75 …)`];
  let score = 40;
  if (group.identity.vendorId === SINOWEALTH_VID) {
    score += 5;
    reasons.push('vendor ID 258A (SinoWealth; shared by unrelated products)');
  }
  return { applicable: true, score, reasons, rejections: [] };
}

const ops = (reportId: number): ProbeOperation[] => [
  {
    level: 'handshake',
    op: 'feature-set',
    collection: 'FF00:0001',
    reportId,
    payloadPrefix: '82 01',
    purpose: 'GET_INFO request for the six-byte model code. A read: the vendor driver sends it to identify the model; nothing is stored.',
    effect: 'none',
    evidence: Evidence.INFERRED,
  },
  {
    level: 'handshake',
    op: 'feature-get',
    collection: 'FF00:0001',
    reportId,
    payloadPrefix: '',
    purpose: 'Read the reply: it echoes 0x82 and carries the model code from byte 7.',
    effect: 'none',
    evidence: Evidence.INFERRED,
  },
];

async function probe(ctx: ProbeContext): Promise<ProbeResult> {
  const ch = findCommandChannel(ctx.group);
  if (!ch) return { status: 'fail', confidence: Evidence.HYPOTHESIS, summary: 'Command channel missing', steps: [], facts: {} };
  if (ctx.level !== 'handshake')
    return {
      status: 'skipped',
      confidence: Evidence.INFERRED,
      summary: 'Descriptor signature only. This family has no passive read; identification needs one read request.',
      steps: [],
      facts: { reportId: ch.reportId },
    };
  const steps: ProbeStep[] = [];
  const t = await ctx.open(ch.iface);
  const session = new ByTechSession(t, ch.reportId, { delayMs: 20 });
  let id: Uint8Array;
  try {
    id = await session.identity();
  } catch (e) {
    steps.push({ name: 'GET_INFO (82 01)', status: 'fail', detail: e instanceof Error ? e.message : String(e) });
    return { status: 'fail', confidence: Evidence.HYPOTHESIS, summary: 'No BY Tech answer to the identity read', steps, facts: { reportId: ch.reportId } };
  }
  const model = modelFor(id, ctx.group.identity.productId);
  steps.push({
    name: 'GET_INFO (82 01)',
    status: 'pass',
    detail: `Answered with model code ${identityHex(id)}${model ? ` (${model.brand} ${model.model})` : ' (not in OpenKey’s table)'}`,
    raw: toHex(id),
  });
  const blank = id.every((b) => b === 0);
  return {
    status: blank ? 'fail' : 'pass',
    confidence: blank ? Evidence.HYPOTHESIS : Evidence.OBSERVED,
    summary: blank
      ? 'The reply echoed the command but carried no model code.'
      : `The keyboard answered the BY Tech identity read${model ? `: ${model.brand} ${model.model}` : ''}.`,
    steps,
    facts: { reportId: ch.reportId, identity: identityHex(id), model: model ? `${model.brand} ${model.model}` : null },
    identified: !blank,
  };
}

export const byTechProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: BY_TECH_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'community',
    transports: { input: ['usb', '2.4ghz', 'bluetooth'], configuration: ['usb'] },
    verification:
      'Implemented from a third-party implementation verified on an AULA F75. Not yet verified by OpenKey on hardware; writes are experimental and always read back.',
    safety:
      'Identification is one read request, always asked first. The settings page is read, patched and written back; models with an unconfirmed layout are read-only until the owner confirms it with the keyboard’s own shortcuts. No reset, firmware or keymap command is sent.',
    provenance: [
      { source: 'public-reverse-engineering', reference: 'github.com/leisiji/AulaSofwareLinux src/proto.rs, src/config_page.rs (MIT; verified on an AULA F75)', status: Evidence.INFERRED },
      { source: 'official-driver', reference: 'RK driver configuration Dev/015E/KB.ini (R75 RGB wired: Psd, Fw), via github.com/vinc3m1/kludgeknight (GPL-3.0; facts only)', status: Evidence.INFERRED },
      { source: 'descriptor', reference: 'RK R75 RGB 258A:015E report descriptor: feature reports 5 (5 B) and 6 (519 B) on FF00:0001', status: Evidence.OBSERVED },
    ],
    license: 'MIT',
    limitations: [
      'Lighting effect, colour, brightness, speed and sleep only; per-key colours, keymap and macros are not implemented.',
      'RK R75 and unknown models: read-only until the settings-page layout is confirmed with the keyboard’s own lighting shortcuts.',
      'USB cable only; the 2.4 GHz receiver and Bluetooth carry no settings.',
      'The keyboard picture is a generic 75 % layout.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'BY Tech OEM protocol (AULA F75/F87/F99/H108, RK R75 and siblings)',
  family: BY_TECH_PROTOCOL_ID,
  priority: 40,
  supportedDevices: 'AULA F75, F87, F87 PRO, F99, F99 Pro, H108 (258A:010C); RK R75 RGB wired (258A:015E); other boards with the same channel',
  supportedFirmware: 'Vendor firmware with the 519-byte command report',
  requiredUsagePages: [0xff00],
  requiredReports: ['FF00 feature id6 (or id9) 519B'],
  evidence: ['leisiji/AulaSofwareLinux (MIT)', 'RK driver configuration for 258A:015E', 'R75 report descriptor (sysfs)'],
  match,
  probePlan: {
    operations: [...ops(6), ...ops(9)],
    // Always asked first: the AULA driver sends this read to 258A:010C, but OpenKey has not verified the
    // family on hardware, and 258A IDs are shared by unrelated products.
    autoConsent: () => ({ auto: false, reason: 'one read request (GET_INFO, the model-code query of the BY Tech driver); asked first until verified on hardware' }),
  },
  probe,
  async createDriver(group, opts) {
    const ch = findCommandChannel(group);
    if (!ch) throw new Error('BY Tech command channel missing');
    const idHex = String(opts.probe?.facts.identity ?? '');
    const identity = Uint8Array.from(idHex.split(' ').filter(Boolean).map((h) => parseInt(h, 16)));
    const driver = new ByTechDriver(group, ch.iface, ch.reportId, identity, modelFor(identity, group.identity.productId) ?? null, {
      store: opts.store,
      open: async (iface) => new LoggingTransport(await group.openInterface(iface), opts.log),
      ...(opts.cmdDelayMs !== undefined ? { delayMs: opts.cmdDelayMs } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    });
    return driver;
  },
};


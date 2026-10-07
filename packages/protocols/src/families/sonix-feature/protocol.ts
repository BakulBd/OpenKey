import { Evidence, toHex } from '@openkey/core';
import { findInterface } from '@openkey/hid';
import type { HidCollection, HidDeviceGroup, HidInterfaceInfo } from '@openkey/hid';
import type {
  CandidateMatch,
  ProbeContext,
  ProbeResult,
  ProbeStep,
  ProtocolDefinition,
} from '../../registry.js';
import { reportSize } from '../../registry.js';
import {
  CONTROL_USAGE,
  CONTROL_USAGE_PAGE,
  Cmd,
  DATA_CHUNK_SIZE,
  DATA_USAGE,
  DATA_USAGE_PAGE,
  PACKET_SIZE,
} from './constants.js';
import { SONIX_FEATURE_PROTOCOL_ID, SonixFeatureDriver, descriptorReportId } from './driver.js';
import { SonixFeatureSession } from './session.js';
import { resolveVariant } from './variants.js';

const isControl = (c: HidCollection) =>
  c.usagePage === CONTROL_USAGE_PAGE &&
  c.usage === CONTROL_USAGE &&
  reportSize(c.featureReports) === PACKET_SIZE;
const isData = (c: HidCollection) =>
  c.usagePage === DATA_USAGE_PAGE &&
  c.usage === DATA_USAGE &&
  reportSize(c.outputReports) === DATA_CHUNK_SIZE;

/** Interfaces whose report sizes are unknown (node-hid on macOS/Windows) match on page/usage only. */
const pageOnly = (page: number, usage: number) => (i: HidInterfaceInfo) =>
  i.sizesKnown === false && i.collections.some((c) => c.usagePage === page && c.usage === usage);

function match(group: HidDeviceGroup): CandidateMatch {
  const reasons: string[] = [];
  const rejections: string[] = [];
  let score = 0;
  let ctrl = findInterface(group, isControl);
  let data = findInterface(group, isData);
  if (!ctrl && group.interfaces.some(pageOnly(CONTROL_USAGE_PAGE, CONTROL_USAGE))) {
    ctrl = group.interfaces.find(pageOnly(CONTROL_USAGE_PAGE, CONTROL_USAGE));
    score -= 20;
    reasons.push('report sizes not exposed by this platform; the START probe decides');
  }
  if (!data && group.interfaces.some(pageOnly(DATA_USAGE_PAGE, DATA_USAGE))) {
    data = group.interfaces.find(pageOnly(DATA_USAGE_PAGE, DATA_USAGE));
  }
  if (ctrl) {
    score += 45;
    reasons.push('control collection FF13:0001 with 64-byte feature report (no report ID)');
  } else {
    rejections.push('no FF13:0001 collection with a 64-byte feature report');
  }
  if (data) {
    score += 35;
    reasons.push('data collection FF68:0061 with 4096-byte output report');
  } else {
    rejections.push('no FF68:0061 collection with a 4096-byte output report (TFT data pipe)');
  }
  const variant = resolveVariant(group.identity.productName);
  if (variant.known) {
    score += 15;
    reasons.push(
      `product string "${group.identity.productName}" matches official driver config (${variant.profile.id})`,
    );
  }
  if (group.identity.vendorId === 0x0c45) score += 5;
  // The control pipe alone is enough to configure; the data pipe is only needed for TFT uploads.
  return { applicable: !!ctrl, score, reasons, rejections };
}

async function probe(ctx: ProbeContext): Promise<ProbeResult> {
  const steps: ProbeStep[] = [];
  const facts: Record<string, unknown> = {};
  const variant = resolveVariant(ctx.group.identity.productName);
  facts.variant = variant.id;
  facts.profile = variant.profile.id;
  facts.knownModel = variant.known;

  const ctrlIface =
    findInterface(ctx.group, isControl) ?? ctx.group.interfaces.find(pageOnly(CONTROL_USAGE_PAGE, CONTROL_USAGE));
  if (!ctrlIface)
    return {
      status: 'fail',
      confidence: Evidence.HYPOTHESIS,
      summary: 'Control collection missing',
      steps,
      facts,
    };
  const control = await ctx.open(ctrlIface);
  const session = new SonixFeatureSession(control, null, { featureReportId: descriptorReportId(ctrlIface, 'featureReports') });

  // Step 1 – passive: GET_FEATURE returns the echo of the last command (zeros after power-up).
  const peek = await session.peek();
  facts.peek = toHex(peek);
  steps.push({
    name: 'GET_FEATURE (passive)',
    status: peek.length === PACKET_SIZE ? 'pass' : 'fail',
    detail: `Feature report readable, ${peek.length} bytes${peek.every((b) => b === 0) ? ' (all zero: no command since power-up)' : ''}`,
    raw: toHex(peek),
  });
  if (peek.length !== PACKET_SIZE) {
    return {
      status: 'fail',
      confidence: Evidence.HYPOTHESIS,
      summary: 'Feature report has unexpected length',
      steps,
      facts,
    };
  }
  if (ctx.level === 'passive') {
    return {
      status: 'pass',
      confidence: Evidence.OBSERVED,
      summary: 'Descriptor signature and readable 64-byte feature report (no command sent).',
      steps,
      facts,
    };
  }

  // Step 2 – handshake: START (04 18) is the first packet of every official transaction; the
  // firmware acknowledges by echoing it with payload[3] = 01. Nothing is written to flash.
  const { ack, response } = await session.sendPacket(
    (() => {
      const p = new Uint8Array(PACKET_SIZE);
      p[0] = 0x04;
      p[1] = Cmd.START;
      return p;
    })(),
    true,
  );
  facts.startAck = response ? toHex(response) : null;
  const ok = !!ack?.ok;
  steps.push({
    name: 'START handshake (04 18)',
    status: ok ? 'pass' : 'fail',
    detail: ok
      ? `Acknowledged: payload[3]=01${ack?.echoes ? ', command echoed (04 18)' : ''}`
      : `No acknowledgement (payload[3]=${ack ? ack.status.toString(16) : '?'})`,
    ...(response ? { raw: toHex(response) } : {}),
  });
  return ok
    ? {
        status: 'pass',
        confidence: Evidence.VERIFIED,
        summary: 'Firmware acknowledged the official START handshake on the FF13 control pipe.',
        steps,
        facts,
      }
    : {
        status: 'fail',
        confidence: Evidence.HYPOTHESIS,
        summary: 'START was not acknowledged',
        steps,
        facts,
      };
}

export const sonixFeatureProtocol: ProtocolDefinition = {
  id: SONIX_FEATURE_PROTOCOL_ID,
  name: 'AJAZZ Windows-driver protocol (feature reports on FF13 + 4096-byte data on FF68)',
  family: 'sonix-feature',
  priority: 50,
  supportedDevices:
    'AK820 MAX / MAX PLUS (TFT), AK820 Pro (Windows-driver firmware), siblings with the same topology',
  supportedFirmware: 'Tested: AK820 MAX bcdDevice 1.07',
  requiredUsagePages: [CONTROL_USAGE_PAGE, DATA_USAGE_PAGE],
  requiredReports: ['FF13:0001 feature id0 64B', 'FF68:0061 output id0 4096B (TFT only)'],
  evidence: [
    'Official AJAZZ AK820 MAX&MAX PLUS ColorScreen driver V1.0.0.5 DeviceDriver.exe (FUN_0044eed0, FUN_0044f3a0, FUN_0044f2d0 …)',
    'aar-rafi/aks075-linux (Ghidra + USB capture of the sibling AKS075)',
  ],
  match,
  probe,
  async createDriver(group, opts) {
    return new SonixFeatureDriver(group, resolveVariant(group.identity.productName), opts);
  },
};

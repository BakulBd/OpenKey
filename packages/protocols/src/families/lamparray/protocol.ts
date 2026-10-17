import { Evidence, toHex } from '@openkey/core';
import { LoggingTransport } from '@openkey/hid';
import type { HidCollection, HidDeviceGroupInfo, HidInterfaceInfo } from '@openkey/hid';
import type {
  CandidateMatch,
  ProbeContext,
  ProbeResult,
  ProtocolDefinition,
} from '../../registry.js';
import { ADAPTER_API_VERSION } from '../../registry.js';
import {
  KIND_NAMES,
  LAMPARRAY_PROTOCOL_ID,
  LIGHTING_PAGE,
  SIZE,
  decodeAttributes,
  isLampArray,
  reportMap,
} from './codec.js';
import type { ReportMap } from './codec.js';
import { LampArrayDriver, MAX_LAMPS } from './driver.js';

/** The interface carrying a usable LampArray collection, with its report map. */
export function findLampArray(
  group: HidDeviceGroupInfo,
): { iface: HidInterfaceInfo; collection: HidCollection; map: ReportMap | string } | undefined {
  for (const iface of group.interfaces)
    for (const collection of iface.collections)
      if (isLampArray(collection)) return { iface, collection, map: reportMap(collection) };
  return undefined;
}

export const lampArrayProtocol: ProtocolDefinition = {
  apiVersion: ADAPTER_API_VERSION,
  id: LAMPARRAY_PROTOCOL_ID,
  manifest: {
    version: '0.1.0',
    status: 'experimental',
    transports: { input: ['usb', '2.4ghz', 'bluetooth'], configuration: ['usb', '2.4ghz'] },
    verification:
      'Implemented from the public HID LampArray standard and tested against a simulator of its reference descriptor; not yet run by OpenKey on a keyboard.',
    safety:
      'Reads the keyboard’s own description of its lamps (feature reports of a reserved usage page) and sets colours that the keyboard does not store; giving the lighting back to the keyboard is one report. Nothing is written to flash.',
    provenance: [
      {
        source: 'public-specification',
        reference:
          'USB-IF HID Usage Tables 1.3+, Lighting And Illumination page (0x59), LampArray; Microsoft Dynamic Lighting reference descriptor',
        status: Evidence.OBSERVED,
      },
      {
        source: 'public-reverse-engineering',
        reference:
          'OpenRGB HIDLampArrayController (GPL-2.0; facts only): report discovery and field order on real devices',
        status: Evidence.INFERRED,
      },
    ],
    license: 'MIT',
    limitations: [
      'Lighting only: LampArray has no key maps, macros or settings.',
      'Colours are not stored by the keyboard and cannot be read back; OpenKey shows what it last sent.',
      'Windows 11 Dynamic Lighting may take the lamps back while it is on (Settings → Personalization → Dynamic Lighting → "Use Dynamic Lighting on my devices").',
      'Needs the nested report collections, which browsers (WebHID) and Linux expose; node-hid on Windows and macOS does not.',
    ],
    fixtures: [],
    verifiedIdentities: [],
  },
  name: 'HID LampArray (Windows Dynamic Lighting standard)',
  family: LAMPARRAY_PROTOCOL_ID,
  priority: 30,
  supportedDevices:
    'Any keyboard (or other device) that implements HID LampArray, e.g. Dynamic Lighting keyboards from Razer, Logitech, ASUS, Microsoft, Keychron and QMK boards built with LampArray support',
  supportedFirmware: 'HID LampArray (HUTRR84)',
  requiredUsagePages: [LIGHTING_PAGE],
  requiredReports: ['59:01 LampArray with its six standard reports'],
  evidence: ['HID Usage Tables: Lighting And Illumination page', 'OpenRGB HIDLampArrayController'],
  probePlan: {
    operations: [
      {
        level: 'handshake',
        op: 'feature-get',
        collection: '0059:0001',
        reportId: 1,
        payloadPrefix: '',
        purpose:
          'Read LampArrayAttributesReport (lamp count, size, kind). Defined by the public standard; sends nothing. The report ID is the one the descriptor names (1 in the reference descriptor).',
        effect: 'none',
        evidence: Evidence.OBSERVED,
      },
    ],
    autoConsent: () => ({
      auto: true,
      reason: 'a read defined by the public HID LampArray standard on its reserved usage page',
    }),
  },
  match(group): CandidateMatch {
    const found = findLampArray(group);
    if (!found)
      return {
        applicable: false,
        score: 0,
        reasons: [],
        rejections: ['no HID LampArray collection (usage page 0x59, usage 0x01)'],
      };
    if (typeof found.map === 'string')
      return {
        applicable: false,
        score: 0,
        reasons: ['HID LampArray collection (59:01)'],
        rejections: [found.map],
      };
    return {
      applicable: true,
      score: 70,
      reasons: [
        'HID LampArray collection (59:01) with the six standard reports',
        `${found.map.multiCapacity} lamps per multi-update report`,
      ],
      rejections: [],
    };
  },
  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const found = findLampArray(ctx.group);
    if (!found || typeof found.map === 'string')
      return {
        status: 'fail',
        confidence: Evidence.HYPOTHESIS,
        summary: 'No usable LampArray collection',
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
    const t = await ctx.open(found.iface);
    const raw = await t
      .receiveFeatureReport(found.map.attributes, SIZE.attributes)
      .catch(() => null);
    const a = raw && raw.length >= SIZE.attributes ? decodeAttributes(raw) : null;
    const ok = !!a && a.lampCount >= 1 && a.lampCount <= MAX_LAMPS;
    return {
      status: ok ? 'pass' : 'fail',
      confidence: ok ? Evidence.VERIFIED : Evidence.HYPOTHESIS,
      summary: ok
        ? `HID LampArray ${KIND_NAMES[a!.kind] ?? 'device'} with ${a!.lampCount} lamps`
        : 'The LampArray attributes could not be read',
      steps: [
        {
          name: 'LampArrayAttributesReport',
          status: ok ? 'pass' : 'fail',
          detail: ok ? `${a!.lampCount} lamps` : 'no valid answer',
          ...(raw ? { raw: toHex(raw) } : {}),
        },
      ],
      facts: ok ? { lamps: a!.lampCount, kind: a!.kind } : {},
      identified: ok,
    };
  },
  async createDriver(group, opts) {
    const found = findLampArray(group);
    if (!found || typeof found.map === 'string')
      throw new Error('No usable HID LampArray collection');
    return new LampArrayDriver(group, found.iface, found.map, {
      store: opts.store,
      open: async (i) => new LoggingTransport(await group.openInterface(i), opts.log),
    });
  },
};

import { Evidence } from '@openkey/core';
import type { HidCollection, HidDeviceGroup } from '@openkey/hid';
import type { CandidateMatch, PlannedAdapter } from '../registry.js';

/**
 * Research-only adapters. Each has a descriptor signature so unknown-device mode can name a
 * *possible* family, and nothing else: no probe, no driver, no packets. Facts come from third-party
 * projects and are recorded in docs/RESEARCH_MATRIX.md; none is verified by OpenKey.
 */

const anyCollection = (g: HidDeviceGroup, pred: (c: HidCollection) => boolean): boolean =>
  g.interfaces.some((i) => i.collections.some(pred));

function result(
  applicable: boolean,
  score: number,
  reasons: string[],
  rejections: string[],
): CandidateMatch {
  return { applicable, score, reasons, rejections };
}

/** VIA/Vial raw HID: usage page 0xFF60, usage 0x61, 32-byte reports (QMK documentation). */
const RAW_HID_USAGE_PAGE = 0xff60;
const RAW_HID_USAGE = 0x61;

export const vialPlanned: PlannedAdapter = {
  id: 'vial',
  name: 'Vial (VIA superset, keyboard definition stored in firmware)',
  family: 'vial',
  manifest: {
    version: '0.0.0',
    status: 'planned',
    transports: { input: ['usb', 'bluetooth'], configuration: [] },
    verification: 'Nothing verified by OpenKey; use Vial or Vialite meanwhile.',
    safety:
      'No packets are sent. Vial protects dangerous operations with a physical unlock; OpenKey will honour it.',
    provenance: [
      {
        source: 'public-specification',
        reference: 'QMK raw HID documentation; vial-kb/vial-gui (GPL-2.0; facts only)',
        status: Evidence.OBSERVED,
      },
    ],
    license: 'MIT',
    limitations: ['Descriptor signature only: names a possible family, never selects it.'],
    fixtures: [],
    verifiedIdentities: [],
  },
  blockers: ['No Vial keyboard available to OpenKey for verification.'],
  signature(g) {
    const hit = anyCollection(
      g,
      (c) => c.usagePage === RAW_HID_USAGE_PAGE && c.usage === RAW_HID_USAGE,
    );
    return hit
      ? result(true, 20, ['raw HID collection FF60:0061 (VIA/Vial signature)'], [])
      : result(false, 0, [], ['no FF60:0061 raw HID collection']);
  },
};

export const PLANNED_ADAPTERS: readonly PlannedAdapter[] = [vialPlanned];

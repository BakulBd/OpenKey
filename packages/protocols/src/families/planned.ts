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

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

function result(applicable: boolean, score: number, reasons: string[], rejections: string[]): CandidateMatch {
  return { applicable, score, reasons, rejections };
}

/** AULA F75 wired: feature report ID 6, 519 bytes after the ID (cloudglides, not-ayan). */
const AULA_FEATURE_REPORT_ID = 6;
const AULA_FEATURE_MIN_BYTES = 512;
/** AULA F75 receiver: output report ID 0x13, 19 bytes after the ID (cloudglides). */
const AULA_DONGLE_OUTPUT_REPORT_ID = 0x13;
const SINOWEALTH_VID = 0x258a;

export const aulaPlanned: PlannedAdapter = {
  id: 'aula-sinowealth',
  name: 'AULA / SinoWealth-style table protocol',
  family: 'aula-sinowealth',
  manifest: {
    version: '0.0.0',
    status: 'planned',
    transports: { input: ['usb', '2.4ghz', 'bluetooth'], configuration: [] },
    verification: 'Nothing verified by OpenKey. Third-party projects configure the AULA F75 over USB only.',
    safety: 'No packets are sent. Third-party sources disagree on the keymap frame header (byte 6).',
    provenance: [
      { source: 'public-reverse-engineering', reference: 'github.com/cloudglides/aula-f75-linux-drivers docs/PROTOCOL.md (no license)', status: Evidence.INFERRED },
      { source: 'public-reverse-engineering', reference: 'github.com/not-ayan/openaula README (no license)', status: Evidence.INFERRED },
    ],
  },
  blockers: [
    'No AULA hardware available to OpenKey.',
    'Sources disagree on the keymap frame header; needs a capture of the official software.',
    '258A:010C is also reported for a SinoWealth "AK820 MAX", so VID:PID cannot identify the model.',
  ],
  signature(g) {
    const reasons: string[] = [];
    const wired = anyCollection(g, (c) =>
      c.featureReports.some((r) => r.reportId === AULA_FEATURE_REPORT_ID && r.size >= AULA_FEATURE_MIN_BYTES),
    );
    const dongle = anyCollection(g, (c) => c.outputReports.some((r) => r.reportId === AULA_DONGLE_OUTPUT_REPORT_ID && r.size === 19));
    if (wired) reasons.push(`feature report ID ${AULA_FEATURE_REPORT_ID} of ≥${AULA_FEATURE_MIN_BYTES} bytes (AULA F75 wired signature, third-party)`);
    if (dongle) reasons.push('output report ID 0x13 of 19 bytes (AULA F75 receiver signature, third-party)');
    let score = wired ? 30 : dongle ? 20 : 0;
    if ((wired || dongle) && g.identity.vendorId === SINOWEALTH_VID) {
      score += 5;
      reasons.push(`vendor ID ${hex4(SINOWEALTH_VID)} (SinoWealth; shared by unrelated products)`);
    }
    return result(wired || dongle, score, reasons, wired || dongle ? [] : ['no AULA report signature']);
  },
};

/** ROYUAN settings channel: vendor page 0xFFFF, usage 2 (some boards 1), 64-byte feature report ID 0 (Sharkfin [HW]). */
const ROYUAN_USAGE_PAGE = 0xffff;
const ROYUAN_USAGES = [1, 2];
const ROYUAN_REPORT_BYTES = 64;

export const royuanPlanned: PlannedAdapter = {
  id: 'royuan',
  name: 'ROYUAN keyboard protocol (yc500 / gen2 command sets)',
  family: 'royuan',
  manifest: {
    version: '0.0.0',
    status: 'planned',
    transports: { input: ['usb', '2.4ghz', 'bluetooth'], configuration: [] },
    verification: 'Nothing verified by OpenKey. Sharkfin documents the protocol with hardware evidence.',
    safety:
      'No packets are sent. The two command sets reuse opcodes with different meanings, and several opcodes erase flash or enter boot mode; the family must be read from the board before any write.',
    provenance: [
      { source: 'public-reverse-engineering', reference: 'github.com/dniminenn/sharkfin docs/PROTOCOL.md (GPL-3.0-or-later; facts only)', status: Evidence.INFERRED },
    ],
  },
  blockers: [
    'No ROYUAN hardware available to OpenKey.',
    'An independent implementation needs the identify reply format and command-set selection verified on a board.',
  ],
  signature(g) {
    const hit = anyCollection(
      g,
      (c) =>
        c.usagePage === ROYUAN_USAGE_PAGE &&
        ROYUAN_USAGES.includes(c.usage) &&
        c.featureReports.some((r) => r.reportId === 0 && r.size === ROYUAN_REPORT_BYTES),
    );
    return hit
      ? result(true, 25, ['vendor collection FFFF:0001/0002 with a 64-byte feature report (ROYUAN signature, third-party)'], [])
      : result(false, 0, [], ['no FFFF collection with a 64-byte feature report']);
  },
};

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
    safety: 'No packets are sent. Vial protects dangerous operations with a physical unlock; OpenKey will honour it.',
    provenance: [
      { source: 'public-specification', reference: 'QMK raw HID documentation; vial-kb/vial-gui (GPL-2.0; facts only)', status: Evidence.OBSERVED },
    ],
  },
  blockers: ['No Vial keyboard available to OpenKey for verification.'],
  signature(g) {
    const hit = anyCollection(g, (c) => c.usagePage === RAW_HID_USAGE_PAGE && c.usage === RAW_HID_USAGE);
    return hit
      ? result(true, 20, ['raw HID collection FF60:0061 (VIA/Vial signature)'], [])
      : result(false, 0, [], ['no FF60:0061 raw HID collection']);
  },
};

export const PLANNED_ADAPTERS: readonly PlannedAdapter[] = [aulaPlanned, royuanPlanned, vialPlanned];

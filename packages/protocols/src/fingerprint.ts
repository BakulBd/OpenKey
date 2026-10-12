import { Evidence } from '@openkey/core';
import type { HidCollection } from '@openkey/hid';
import type { DetectionReport, PossibleFamily } from './registry.js';

/** How sure OpenKey is about what the device is. */
export type DetectionConfidence = 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERIFIED';

export interface FingerprintSignal {
  kind: 'identity' | 'descriptor' | 'protocol' | 'catalog';
  name: string;
  value: string;
}

/**
 * Everything OpenKey used to identify a device, with an explanation a user can read ("Detected
 * because …"). The descriptor signature is part of the fingerprint because two products can share
 * a VID:PID and still speak different protocols.
 */
export interface DeviceFingerprint {
  /** VID:PID plus a canonical descriptor signature; equal fingerprints have identical HID layouts. */
  key: string;
  vendorId: number;
  productId: number;
  productName: string;
  manufacturer?: string;
  descriptorSignature: string;
  signals: FingerprintSignal[];
  adapterId: string | null;
  protocolFamily: string | null;
  confidence: DetectionConfidence;
  explanation: string[];
  possibleFamilies: PossibleFamily[];
}

const h = (n: number, w = 4): string => n.toString(16).toUpperCase().padStart(w, '0');

function collectionSignature(c: HidCollection): string {
  const r = (list: { reportId: number; size: number }[]) =>
    list
      .map((x) => `${x.reportId}:${x.size}`)
      .sort()
      .join(',');
  return `${h(c.usagePage)}:${h(c.usage)}[i${r(c.inputReports)}|o${r(c.outputReports)}|f${r(c.featureReports)}]`;
}

export function descriptorSignature(report: Pick<DetectionReport, 'interfaces'>): string {
  return report.interfaces
    .flatMap((i) => i.collections.map(collectionSignature))
    .sort()
    .join(' ');
}

export function detectionConfidence(report: DetectionReport): DetectionConfidence {
  const sel = report.selected;
  if (sel) {
    const probe = report.candidates.find((c) => c.protocol.id === sel.protocolId)?.probe;
    if (probe?.identified && sel.confidence === Evidence.VERIFIED) return 'VERIFIED';
    if (probe?.identified) return 'HIGH';
    return 'MEDIUM';
  }
  if (report.ambiguous || report.possibleFamilies.length > 0 || report.catalog) return 'LOW';
  return 'UNKNOWN';
}

export function buildFingerprint(report: DetectionReport): DeviceFingerprint {
  const d = report.device;
  const sig = descriptorSignature(report);
  const signals: FingerprintSignal[] = [
    { kind: 'identity', name: 'VID:PID', value: `${h(d.vendorId)}:${h(d.productId)}` },
    { kind: 'identity', name: 'product', value: d.productName },
  ];
  if (d.manufacturer)
    signals.push({ kind: 'identity', name: 'manufacturer', value: d.manufacturer });
  if (d.release !== undefined)
    signals.push({ kind: 'identity', name: 'bcdDevice', value: `0x${h(d.release)}` });
  for (const i of report.interfaces)
    for (const c of i.collections)
      signals.push({ kind: 'descriptor', name: 'collection', value: collectionSignature(c) });
  if (report.catalog)
    signals.push({ kind: 'catalog', name: 'catalogue', value: report.catalog.model });

  const sel = report.selected;
  const cand = sel ? report.candidates.find((c) => c.protocol.id === sel.protocolId) : undefined;
  if (cand?.probe && cand.probe.status !== 'skipped')
    signals.push({ kind: 'protocol', name: cand.protocol.id, value: cand.probe.summary });

  const confidence = detectionConfidence(report);
  const explanation: string[] = [];
  if (sel && cand) {
    explanation.push(`Detected as ${cand.protocol.name} because:`);
    explanation.push(...cand.match.reasons.map((r) => `• ${r}`));
    if (cand.probe) explanation.push(`• ${cand.probe.summary}`);
  } else if (report.ambiguous) {
    explanation.push('Several protocols match equally; OpenKey will not guess.', ...report.notes);
  } else if (report.possibleFamilies.length) {
    explanation.push(
      'No adapter is confirmed for this device. Its descriptors resemble:',
      ...report.possibleFamilies.map((f) => `• ${f.name} (${f.status}): ${f.reasons.join('; ')}`),
      'A resemblance is not support: nothing is written to this device.',
    );
  } else {
    explanation.push('No adapter or known protocol family matches these descriptors.');
  }
  if (report.catalog)
    explanation.push(
      `Catalogue: ${report.catalog.model} — names the device only; it never selects a protocol.`,
    );

  return {
    key: `${h(d.vendorId)}:${h(d.productId)}#${sig}`,
    vendorId: d.vendorId,
    productId: d.productId,
    productName: d.productName,
    ...(d.manufacturer ? { manufacturer: d.manufacturer } : {}),
    descriptorSignature: sig,
    signals,
    adapterId: sel?.protocolId ?? null,
    protocolFamily: cand?.protocol.family ?? null,
    confidence,
    explanation,
    possibleFamilies: report.possibleFamilies,
  };
}

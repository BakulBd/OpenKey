import { describeCollections } from '@openkey/hid';
import { formatBcd, hex16 } from '@openkey/core';
import type { DetectionReport } from './registry.js';

const COLLECTION_NAMES: Record<string, string> = {
  '1:6': 'Keyboard',
  '1:2': 'Mouse',
  '1:128': 'System Control',
  '12:1': 'Consumer Control',
};

function collectionName(page: number, usage: number): string {
  return (
    COLLECTION_NAMES[`${page}:${usage}`] ??
    `${page.toString(16).toUpperCase().padStart(4, '0')} / 0x${usage.toString(16).padStart(2, '0')}`
  );
}

/** Plain-text rendering used by `openkey detect` (verbose adds descriptors and probe steps). */
export function formatDetectionReport(r: DetectionReport, verbose = false): string {
  const L: string[] = [];
  L.push('USB device found');
  L.push(`  VID: ${hex16(r.device.vendorId)}`);
  L.push(`  PID: ${hex16(r.device.productId)}`);
  L.push(
    `  Product: ${r.device.productName}${r.device.manufacturer ? ` (${r.device.manufacturer})` : ''}`,
  );
  if (r.device.release !== undefined) L.push(`  bcdDevice: ${formatBcd(r.device.release)}`);
  if (r.catalog) L.push(`  Known as: ${r.catalog.model} (${r.catalog.mcu}; ${r.catalog.status})`);
  L.push(`  Link: ${r.device.transportHint}   Backend: ${r.device.backend}`);
  L.push('');
  L.push('Collections:');
  for (const i of r.interfaces) {
    const where = [i.interfaceNumber !== undefined ? `if${i.interfaceNumber}` : null, i.path]
      .filter(Boolean)
      .join(' ');
    for (const c of i.collections)
      L.push(`  - ${collectionName(c.usagePage, c.usage)}${where ? `   [${where}]` : ''}`);
    if (verbose) for (const d of describeCollections(i.collections)) L.push(`      ${d}`);
  }
  L.push('');
  for (const c of r.candidates) {
    L.push(`Candidate protocol: ${c.protocol.name}`);
    if (!c.match.applicable) {
      L.push(`  Descriptor match: NO (${c.match.rejections.join('; ')})`);
      L.push('  Probe: SKIPPED');
      continue;
    }
    L.push(`  Descriptor match: yes, score ${c.match.score}`);
    if (verbose) for (const reason of c.match.reasons) L.push(`    + ${reason}`);
    const p = c.probe;
    L.push(
      `  Probe: ${p ? (p.status === 'pass' ? 'PASS' : p.status.toUpperCase()) : 'not run'}${p ? ` – ${p.summary}` : ''}`,
    );
    if (verbose && p) {
      for (const s of p.steps) {
        L.push(`    [${s.status}] ${s.name}: ${s.detail}`);
        if (s.raw) L.push(`           ${s.raw.length > 120 ? `${s.raw.slice(0, 120)}…` : s.raw}`);
      }
    }
  }
  L.push('');
  if (r.selected) {
    L.push(`Selected: ${r.selected.protocolId}`);
    L.push(`Confidence: ${r.selected.confidence}`);
    if (verbose) for (const reason of r.selected.reasons) L.push(`  because: ${reason}`);
  } else {
    L.push('Selected: none');
  }
  for (const n of r.notes) L.push(`Note: ${n}`);
  return L.join('\n');
}

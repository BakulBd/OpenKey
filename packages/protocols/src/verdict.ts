import { CATALOG, lookupCatalogAll } from '@openkey/devices';
import type { TransportMode } from '@openkey/core';
import type { CandidateReport, DetectionReport, ProbeOperation, ProtocolRegistry, VerifiedIdentity } from './registry.js';
import { detectionConfidence } from './fingerprint.js';
import type { DetectionConfidence } from './fingerprint.js';

/**
 * The outcome of detection, in the terms a user acts on. Exactly one applies.
 * - VERIFIED_MATCH: the family was identified by the device, and this identity (and firmware, where
 *   known) is one the adapter was verified on.
 * - FIRMWARE_UNVERIFIED: the family was identified, but this model or firmware was never verified.
 * - TRANSPORT_UNSUPPORTED: the family is known, but it is not configurable over the current link.
 * - STRONG_CANDIDATE: an implemented adapter matches; its identification step has not run (consent
 *   missing, or offline analysis).
 * - AMBIGUOUS: several adapters match equally; OpenKey will not choose.
 * - FAMILY_CANDIDATE: only research signatures resemble the device, or an adapter matched but the
 *   device did not confirm it. A resemblance is never support.
 * - INSPECT_ONLY: the identity is catalogued, but no adapter can configure it.
 * - SIMULATED: a firmware simulator, not hardware. Nothing about a physical keyboard follows from it.
 * - UNKNOWN: nothing matches.
 */
export type VerdictKind =
  | 'VERIFIED_MATCH'
  | 'FIRMWARE_UNVERIFIED'
  | 'TRANSPORT_UNSUPPORTED'
  | 'STRONG_CANDIDATE'
  | 'AMBIGUOUS'
  | 'FAMILY_CANDIDATE'
  | 'INSPECT_ONLY'
  | 'SIMULATED'
  | 'UNKNOWN';

export type NextAction =
  /** Open the configuration pages (writes still pass the per-feature safety policy). */
  | { kind: 'configure'; adapterId: string }
  /** Ask the user to allow the adapter's identification handshake; lists exactly what is sent. */
  | { kind: 'consent-probe'; adapterId: string; operations: ProbeOperation[] }
  /** Offline analysis: connect the device so the identification step can run. */
  | { kind: 'connect-device'; adapterId: string }
  | { kind: 'switch-transport'; transports: TransportMode[] }
  /** Inspect, export diagnostics and contribute; nothing can be configured. */
  | { kind: 'contribute' };

export interface DetectionVerdict {
  kind: VerdictKind;
  adapterId: string | null;
  confidence: DetectionConfidence;
  /** True only when a driver may be created at all. Each write still passes `writeDecision`. */
  writeEligible: boolean;
  /** Why this verdict, in order of weight. */
  reasons: string[];
  /** Evidence that points elsewhere or disagrees. */
  conflicts: string[];
  /** Signals that were not available, so nobody mistakes their absence for a negative result. */
  unknowns: string[];
  next: NextAction;
}

const h4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

function identityMatches(
  v: VerifiedIdentity,
  d: DetectionReport['device'],
): 'exact' | 'other-firmware' | 'no' {
  if (v.vendorId !== d.vendorId || v.productId !== d.productId) return 'no';
  if (v.productName !== undefined && v.productName !== d.productName.trim()) return 'no';
  if (v.release !== undefined && d.release !== undefined && v.release !== d.release) return 'other-firmware';
  return 'exact';
}

function unknownSignals(report: DetectionReport): string[] {
  const d = report.device;
  const offline = d.backend === 'offline';
  const missing = offline ? 'is not recorded in this diagnostic file' : 'is not exposed by this platform';
  const out: string[] = [];
  if (offline) out.push('Offline analysis of a diagnostic file: the device is not present, so it could not be asked anything.');
  if (d.release === undefined) out.push(`bcdDevice (a firmware hint) ${missing}.`);
  if (d.manufacturer === undefined) out.push(`The manufacturer string ${missing}.`);
  if (report.interfaces.every((i) => i.interfaceNumber === undefined))
    out.push(
      offline
        ? 'USB interface numbers are not recorded; interfaces are told apart by collections.'
        : 'USB interface numbers are not exposed (WebHID hides them); interfaces are told apart by collections.',
    );
  if (report.level === 'descriptor' && !offline) out.push('Only descriptors were evaluated; no read or handshake was performed.');
  out.push('The firmware version is not reported by any implemented protocol for this device.');
  return out;
}

function failedCandidates(report: DetectionReport): CandidateReport[] {
  return report.candidates.filter(
    (c) => c.match.applicable && (c.probe?.status === 'fail' || c.probe?.status === 'error'),
  );
}

/**
 * Turns a detection report into an explainable verdict. Pure: performs no I/O. A similarity score
 * never becomes a compatibility claim: only `ProbeResult.identified` makes a device write-eligible.
 */
export function detectionVerdict(report: DetectionReport, registry: ProtocolRegistry): DetectionVerdict {
  const d = report.device;
  const confidence = detectionConfidence(report);
  const reasons: string[] = [];
  const conflicts: string[] = [];
  const unknowns = unknownSignals(report);

  // Catalogue and vendor-ID signals: naming only, never selection.
  const shared = lookupCatalogAll({ vendorId: d.vendorId, productId: d.productId, productName: d.productName });
  if (shared.length > 1)
    conflicts.push(
      `${h4(d.vendorId)}:${h4(d.productId)} is used by different products (${shared.map((e) => `${e.brand} ${e.model}`).join('; ')}).`,
    );
  if (!report.catalog && shared.length === 0) {
    const sameVendor = CATALOG.filter((e) => e.vendorId === d.vendorId);
    if (sameVendor.length)
      reasons.push(
        `Weak signal only: vendor ID ${h4(d.vendorId)} also appears on catalogued ${[...new Set(sameVendor.map((e) => e.mcu))].join(', ')} boards. A vendor ID identifies no protocol.`,
      );
  }
  for (const c of failedCandidates(report))
    conflicts.push(`${c.protocol.id} matched the descriptors but the device did not confirm it: ${c.probe!.summary}`);

  const base = (partial: Omit<DetectionVerdict, 'confidence' | 'reasons' | 'conflicts' | 'unknowns'> & { reasons?: string[] }): DetectionVerdict => ({
    ...partial,
    confidence,
    reasons: [...(partial.reasons ?? []), ...reasons],
    conflicts,
    unknowns,
  });

  const sel = report.selected;
  const selCand = sel ? report.candidates.find((c) => c.protocol.id === sel.protocolId) : undefined;
  const def = sel ? registry.get(sel.protocolId) : undefined;

  if (d.backend === 'mock')
    return base({
      kind: 'SIMULATED',
      adapterId: sel?.protocolId ?? null,
      writeEligible: !!sel && sel.identification === 'identified',
      reasons: ['This is a firmware simulator. It runs the real protocol code, but proves nothing about a physical keyboard.'],
      next: sel ? { kind: 'configure', adapterId: sel.protocolId } : { kind: 'contribute' },
    });

  if (report.catalog && sel && def && !report.catalog.family.includes(sel.protocolId))
    conflicts.push(`The catalogue lists this identity under "${report.catalog.family}", the device answered as ${sel.protocolId}.`);

  if (sel && def && sel.identification === 'identified') {
    const why = [...(selCand?.match.reasons ?? []), selCand?.probe?.summary ?? ''].filter(Boolean);
    if (!def.manifest.transports.configuration.includes(d.transportHint))
      return base({
        kind: 'TRANSPORT_UNSUPPORTED',
        adapterId: def.id,
        writeEligible: false,
        reasons: [`${def.name} is configurable only over ${def.manifest.transports.configuration.join(', ') || 'no link'}; this link is ${d.transportHint}.`, ...why],
        next: { kind: 'switch-transport', transports: def.manifest.transports.configuration },
      });
    const matches = def.manifest.verifiedIdentities.map((v) => ({ v, m: identityMatches(v, d) }));
    const exact = matches.find((x) => x.m === 'exact');
    const otherFw = matches.find((x) => x.m === 'other-firmware');
    if (exact)
      return base({
        kind: 'VERIFIED_MATCH',
        adapterId: def.id,
        writeEligible: true,
        reasons: [`Identified by the device, and this identity was verified on hardware (${exact.v.scope}; ${exact.v.evidence}).`, ...why],
        next: { kind: 'configure', adapterId: def.id },
      });
    if (otherFw)
      conflicts.push(
        `Verified on firmware ${h4(otherFw.v.release!)}; this unit reports ${h4(d.release!)}. Behaviour may differ.`,
      );
    return base({
      kind: 'FIRMWARE_UNVERIFIED',
      adapterId: def.id,
      writeEligible: true,
      reasons: [`The device answered as ${def.family}, but this model or firmware was never verified on hardware. Writes stay experimental.`, ...why],
      next: { kind: 'configure', adapterId: def.id },
    });
  }

  if (report.ambiguous)
    return base({
      kind: 'AMBIGUOUS',
      adapterId: null,
      writeEligible: false,
      reasons: ['Several adapters match equally. OpenKey does not guess between protocols that may read the same bytes differently.', ...report.notes],
      next: { kind: 'contribute' },
    });

  // An implemented adapter matches and its identification step has not run.
  const pending = report.candidates
    .filter((c) => c.match.applicable && !c.probe?.identified && c.probe?.status !== 'fail' && c.probe?.status !== 'error')
    .map((c) => ({ c, p: registry.get(c.protocol.id)! }))
    .filter(({ p }) => p.probePlan.operations.some((o) => o.level === 'handshake'))
    .sort((a, b) => b.c.match.score - a.c.match.score);
  if (pending.length) {
    const { c, p } = pending[0]!;
    const why = [
      `Descriptors match ${p.name}: ${c.match.reasons.join('; ')}.`,
      c.consent?.required ? `Identification not run automatically: ${c.consent.reason}.` : 'Identification has not run yet.',
    ];
    return base({
      kind: 'STRONG_CANDIDATE',
      adapterId: p.id,
      writeEligible: false,
      reasons: why,
      next:
        d.backend === 'offline'
          ? { kind: 'connect-device', adapterId: p.id }
          : { kind: 'consent-probe', adapterId: p.id, operations: p.probePlan.operations },
    });
  }

  const resemble = report.possibleFamilies;
  if (resemble.length || failedCandidates(report).length)
    return base({
      kind: 'FAMILY_CANDIDATE',
      adapterId: null,
      writeEligible: false,
      reasons: [
        ...resemble.map((f) => `Resembles ${f.name} (${f.status}): ${f.reasons.join('; ')}.`),
        'A resemblance is not support: nothing can be configured until a family is identified by the device and an adapter is verified.',
      ],
      next: { kind: 'contribute' },
    });

  if (report.catalog)
    return base({
      kind: 'INSPECT_ONLY',
      adapterId: null,
      writeEligible: false,
      reasons: [`Catalogued as ${report.catalog.brand} ${report.catalog.model} (${report.catalog.status}): ${report.catalog.evidence}. No adapter can configure it yet.`],
      next: { kind: 'contribute' },
    });

  return base({
    kind: 'UNKNOWN',
    adapterId: null,
    writeEligible: false,
    reasons: ['No adapter, research signature or catalogue entry matches these descriptors.'],
    next: { kind: 'contribute' },
  });
}

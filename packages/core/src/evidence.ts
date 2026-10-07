/**
 * Evidence statuses used throughout code, fixtures and documentation. One vocabulary for every
 * protocol and device fact, so a status means the same thing in a fixture, a capability and a doc.
 *
 * A status is never promoted without new evidence: INFERRED never becomes VERIFIED because a sibling
 * device behaves that way, and UNKNOWN never becomes "supported" by analogy.
 */
export const Evidence = {
  /** Operation succeeded on real hardware and the result was observed (read-back or independent check). */
  VERIFIED: 'VERIFIED',
  /** Seen in a primary source: official driver code path, captures of the official software, descriptors. Not yet verified by OpenKey on hardware. */
  OBSERVED: 'OBSERVED',
  /** Derived from a single community source, a pattern, or a sibling device. */
  INFERRED: 'INFERRED',
  /** A guess that still needs any evidence at all. Never used for writes. */
  HYPOTHESIS: 'HYPOTHESIS',
  /** Exists as a question; nothing is known. */
  UNKNOWN: 'UNKNOWN',
  /** Implemented or documented, but the hardware test has not been run. */
  NOT_TESTED: 'NOT_TESTED',
} as const;

export type Evidence = (typeof Evidence)[keyof typeof Evidence];

export const EVIDENCE_LEVELS: readonly Evidence[] = Object.values(Evidence);

const RANK: Record<Evidence, number> = {
  VERIFIED: 4,
  OBSERVED: 3,
  INFERRED: 2,
  HYPOTHESIS: 1,
  NOT_TESTED: 0,
  UNKNOWN: 0,
};

export function evidenceRank(c: Evidence): number {
  return RANK[c];
}

export function atLeast(c: Evidence, minimum: Evidence): boolean {
  return RANK[c] >= RANK[minimum];
}

export function weakest(...cs: Evidence[]): Evidence {
  return cs.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b), Evidence.VERIFIED);
}

export function isEvidence(v: unknown): v is Evidence {
  return typeof v === 'string' && v in RANK;
}

/** Where a fact comes from. */
export type EvidenceSource =
  | 'descriptor'
  | 'hardware-capture'
  | 'official-driver'
  | 'controlled-experiment'
  | 'public-reverse-engineering'
  | 'firmware-analysis'
  | 'packet-fixture'
  | 'hardware-verification'
  | 'public-specification';

/** One documented protocol or device fact (PROTOCOL_SOURCES.md uses the same fields). */
export interface ProvenanceRecord {
  fact: string;
  source: EvidenceSource;
  /** Human-readable pointer: a fixture path, a driver function, a repository URL. */
  reference: string;
  status: Evidence;
  /** ISO date the evidence was gathered. */
  date: string;
  /** Hardware and firmware the fact was observed on, when applicable. */
  device?: string;
  firmware?: string;
}

/**
 * Promotion rule: a fact may only become VERIFIED from a hardware verification or a controlled
 * experiment on real hardware. Returns the status a new piece of evidence justifies, never higher
 * than what the source can prove.
 */
export function statusFromSource(source: EvidenceSource): Evidence {
  switch (source) {
    case 'hardware-verification':
    case 'controlled-experiment':
      return Evidence.VERIFIED;
    case 'descriptor':
    case 'hardware-capture':
    case 'official-driver':
    case 'firmware-analysis':
    case 'packet-fixture':
    case 'public-specification':
      return Evidence.OBSERVED;
    case 'public-reverse-engineering':
      return Evidence.INFERRED;
  }
}

/**
 * Evidence levels used throughout code, fixtures and documentation.
 * An inference is never promoted to CONFIRMED without hardware or official-driver evidence.
 */
export const Confidence = {
  /** Verified on hardware, or reproduced byte-for-byte from the official driver's code path and verified. */
  CONFIRMED: 'CONFIRMED',
  /** Traced in official driver code or multiple independent captures, not yet verified on this hardware. */
  STRONGLY_SUPPORTED: 'STRONGLY_SUPPORTED',
  /** Derived from a single community source or by analogy with a sibling device. */
  INFERRED: 'INFERRED',
  /** Not verified at all. Never used for writes. */
  UNVERIFIED: 'UNVERIFIED',
} as const;

export type Confidence = (typeof Confidence)[keyof typeof Confidence];

const RANK: Record<Confidence, number> = {
  CONFIRMED: 3,
  STRONGLY_SUPPORTED: 2,
  INFERRED: 1,
  UNVERIFIED: 0,
};

export function confidenceRank(c: Confidence): number {
  return RANK[c];
}

export function atLeast(c: Confidence, minimum: Confidence): boolean {
  return RANK[c] >= RANK[minimum];
}

export function weakest(...cs: Confidence[]): Confidence {
  return cs.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b), Confidence.CONFIRMED);
}

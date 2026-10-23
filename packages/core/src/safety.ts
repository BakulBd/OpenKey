import { Evidence } from './evidence.js';
import type { FeatureSupport } from './model/capabilities.js';

/**
 * Risk class of one operation.
 * - READ_ONLY: nothing is written.
 * - SAFE_VOLATILE: changes RAM state only; a replug restores the previous state.
 * - SAFE_PERSISTENT: writes settings to flash; the official software does the same and the user can
 *   change them back.
 * - CAUTION: persistent and not readable back (the previous value is lost unless a backup exists).
 * - HIGH_RISK: can leave the keyboard needing a factory reset (bulk uploads, defaults restore).
 * - UNSAFE: firmware, bootloader, erase. Never exposed by OpenKey.
 * - UNVERIFIED: risk unknown because the operation was never exercised.
 */
export const SafetyLevel = {
  READ_ONLY: 'READ_ONLY',
  SAFE_VOLATILE: 'SAFE_VOLATILE',
  SAFE_PERSISTENT: 'SAFE_PERSISTENT',
  CAUTION: 'CAUTION',
  HIGH_RISK: 'HIGH_RISK',
  UNSAFE: 'UNSAFE',
  UNVERIFIED: 'UNVERIFIED',
} as const;
export type SafetyLevel = (typeof SafetyLevel)[keyof typeof SafetyLevel];

export interface SafetyContext {
  /** The device is a simulator: nothing physical can be harmed. */
  simulated: boolean;
  /** The user enabled experimental writes in settings for this session. */
  experimentalEnabled: boolean;
}

export type WriteDecision =
  /** Normal UI may write after the usual Apply step. */
  | { kind: 'allowed' }
  /** Allowed only after the user enabled experimental writes, with an explicit confirmation. */
  | { kind: 'experimental'; reason: string }
  /** Never written from the UI. */
  | { kind: 'blocked'; reason: string };

/**
 * Decides whether the UI may offer a write. Normal UI exposes only operations verified on hardware
 * (with a confirmation for CAUTION and HIGH_RISK); everything else is experimental (opt-in) or blocked.
 */
export function writeDecision(support: FeatureSupport, ctx: SafetyContext): WriteDecision {
  if (!support.write)
    return {
      kind: 'blocked',
      reason: support.blockedReason ?? 'The device or protocol offers no write for this feature.',
    };
  const safety = support.safety ?? SafetyLevel.UNVERIFIED;
  if (safety === SafetyLevel.UNSAFE)
    return { kind: 'blocked', reason: 'Firmware-level operations are outside OpenKey’s scope.' };
  if (ctx.simulated) return { kind: 'allowed' };
  if (support.confidence === Evidence.HYPOTHESIS || support.confidence === Evidence.UNKNOWN)
    return { kind: 'blocked', reason: 'No evidence for this command; it is never sent.' };

  const verified = support.confidence === Evidence.VERIFIED;
  // A hardware-verified write is offered in normal UI whatever its risk class: the UI asks once per
  // session for CAUTION (previous value not readable) and every time for HIGH_RISK. Unverified
  // writes, and writes whose risk was never assessed, stay behind the experimental opt-in.
  const knownClass =
    safety === SafetyLevel.SAFE_VOLATILE ||
    safety === SafetyLevel.SAFE_PERSISTENT ||
    safety === SafetyLevel.CAUTION ||
    safety === SafetyLevel.HIGH_RISK;
  if (verified && knownClass) return { kind: 'allowed' };

  const reason = !verified
    ? `Not yet verified on hardware (evidence: ${support.confidence.toLowerCase().replace('_', ' ')}).`
    : `Risk class ${safety.toLowerCase().replace('_', ' ')}.`;
  return { kind: 'experimental', reason };
}

/** True when the UI may send the write now (experimental writes need the opt-in). */
export function mayWrite(decision: WriteDecision, ctx: SafetyContext): boolean {
  return (
    decision.kind === 'allowed' || (decision.kind === 'experimental' && ctx.experimentalEnabled)
  );
}

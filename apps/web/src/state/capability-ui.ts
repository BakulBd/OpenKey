import { FeatureStatus, writeDecision } from '@openkey/core';
import type { Capabilities, FeatureId, FeatureSupport, SafetyContext } from '@openkey/core';

/**
 * How a capability is presented to users, in plain terms. Derived only from the adapter's
 * evidence-backed capability and the shared write policy, so the UI can never claim more than the
 * adapter does.
 */
export type UiState =
  /** Writes are verified and allowed normally. */
  | 'ready'
  /** Writes exist but are not verified on hardware: opt-in only. */
  | 'experimental'
  /** Readable, not writable. */
  | 'readOnly'
  /** Exists with a fixed value. */
  | 'fixed'
  /** Hardware exists and works, but has no configuration protocol. */
  | 'hardwareOnly'
  /** Probably configurable, protocol not yet known. */
  | 'research'
  /** Not available over the current connection. */
  | 'transport'
  /** Not available on this firmware. */
  | 'firmware'
  /** Evidence says the device does not have it. */
  | 'unsupported'
  /** No evidence either way. */
  | 'unknown';

const ORDER: UiState[] = ['ready', 'experimental', 'readOnly', 'fixed', 'hardwareOnly', 'research', 'transport', 'firmware', 'unsupported', 'unknown'];

export function featureUiState(s: FeatureSupport, ctx: SafetyContext): UiState {
  if (s.write) {
    const d = writeDecision(s, ctx);
    if (d.kind === 'allowed') return 'ready';
    if (d.kind === 'experimental') return 'experimental';
    if (s.read !== 'none') return 'readOnly';
  }
  if (s.read !== 'none') return 'readOnly';
  switch (s.status) {
    case FeatureStatus.FIXED:
      return 'fixed';
    case FeatureStatus.PHYSICALLY_PRESENT:
      return 'hardwareOnly';
    case FeatureStatus.NOT_YET_REVERSE_ENGINEERED:
      return 'research';
    case FeatureStatus.TRANSPORT_LIMITED:
      return 'transport';
    case FeatureStatus.FIRMWARE_LIMITED:
      return 'firmware';
    case FeatureStatus.NOT_SUPPORTED:
      return 'unsupported';
    default:
      return 'unknown';
  }
}

/** The most useful state among several features (a page is as available as its best feature). */
export function bestUiState(caps: Capabilities, features: FeatureId[], ctx: SafetyContext): UiState {
  return features.map((f) => featureUiState(caps[f], ctx)).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0] ?? 'unknown';
}

/** Whether a task with this state belongs in the "what you can do" list (rather than "not available"). */
export function isActionable(s: UiState): boolean {
  return s === 'ready' || s === 'experimental' || s === 'readOnly';
}

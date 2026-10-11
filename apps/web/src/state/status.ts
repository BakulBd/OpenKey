import type { ConnectionState, Operation } from '@openkey/core';
import type { VerdictKind } from '@openkey/protocols';

/**
 * One derived description of "what is connected and what can be done", computed from the
 * connection state machine, the session and the running operation. Every surface (status bar,
 * device chip, overview, connect page) reads this instead of combining booleans on its own, so they
 * cannot contradict each other.
 */
export type SessionMode =
  /** Nothing selected. */
  | 'none'
  /** Permission prompt, opening, inspecting, identifying. */
  | 'connecting'
  /** A physical keyboard with an identified protocol. */
  | 'hardware'
  /** The demo firmware simulator. */
  | 'simulated'
  /** A physical device without a configurable adapter: inspection only. */
  | 'inspect'
  /** The last attempt failed. */
  | 'error';

export type IdentityLevel = 'verified' | 'identified' | 'candidate' | 'ambiguous' | 'unknown' | 'simulated';

export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

export interface StatusSummary {
  mode: SessionMode;
  identity: IdentityLevel | null;
  /** Whether a driver exists (writes still pass the per-feature policy). */
  configurable: boolean;
  /** Translation key of the one-line headline. */
  headline: StatusKey;
  tone: Tone;
  /** The device-changing operation in progress, if any. */
  operation: Operation | null;
}

export type StatusKey =
  | 'status.none'
  | 'status.connecting'
  | 'status.identifying'
  | 'status.reading'
  | 'status.verified'
  | 'status.identified'
  | 'status.readOnlyTransport'
  | 'status.simulated'
  | 'status.candidate'
  | 'status.ambiguous'
  | 'status.unknown'
  | 'status.error';

export function identityOf(kind: VerdictKind): IdentityLevel {
  switch (kind) {
    case 'VERIFIED_MATCH':
      return 'verified';
    case 'FIRMWARE_UNVERIFIED':
    case 'TRANSPORT_UNSUPPORTED':
      return 'identified';
    case 'STRONG_CANDIDATE':
    case 'FAMILY_CANDIDATE':
      return 'candidate';
    case 'AMBIGUOUS':
      return 'ambiguous';
    case 'SIMULATED':
      return 'simulated';
    case 'INSPECT_ONLY':
    case 'UNKNOWN':
      return 'unknown';
  }
}

/** The minimum a session must provide to be summarised. */
export interface SessionLike {
  kind: 'device' | 'unknown';
  demo?: boolean;
  verdict: { kind: VerdictKind };
}

export function summarize(conn: ConnectionState, session: SessionLike | null, operation: Operation | null): StatusSummary {
  const base = { operation };
  if (!session) {
    if (conn.status === 'ERROR') return { ...base, mode: 'error', identity: null, configurable: false, headline: 'status.error', tone: 'danger' };
    if (conn.status === 'DISCONNECTED' || conn.status === 'DISCONNECTING')
      return { ...base, mode: 'none', identity: null, configurable: false, headline: 'status.none', tone: 'neutral' };
    const headline: StatusKey =
      conn.status === 'DETECTING' || conn.status === 'INSPECTING' ? 'status.identifying' : conn.status === 'READING' ? 'status.reading' : 'status.connecting';
    return { ...base, mode: 'connecting', identity: null, configurable: false, headline, tone: 'info' };
  }
  const identity = identityOf(session.verdict.kind);
  // Re-identification after consent runs while the old unknown session is still shown.
  if (conn.status === 'DETECTING') return { ...base, mode: 'connecting', identity, configurable: false, headline: 'status.identifying', tone: 'info' };
  if (session.kind === 'device' && session.demo)
    return { ...base, mode: 'simulated', identity: 'simulated', configurable: true, headline: 'status.simulated', tone: 'info' };
  if (session.kind === 'device') {
    const verified = identity === 'verified';
    return { ...base, mode: 'hardware', identity, configurable: true, headline: verified ? 'status.verified' : 'status.identified', tone: verified ? 'ok' : 'info' };
  }
  const headline: StatusKey =
    session.verdict.kind === 'TRANSPORT_UNSUPPORTED'
      ? 'status.readOnlyTransport'
      : identity === 'candidate'
        ? 'status.candidate'
        : identity === 'ambiguous'
          ? 'status.ambiguous'
          : 'status.unknown';
  return { ...base, mode: 'inspect', identity, configurable: false, headline, tone: identity === 'unknown' ? 'neutral' : 'warn' };
}

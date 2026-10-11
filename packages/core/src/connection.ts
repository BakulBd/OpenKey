/**
 * Explicit connection state machine. One status replaces scattered booleans, and the transition
 * table makes the safety rules checkable: only READY may start APPLYING, and no event produced by a
 * reconnect leads to APPLYING.
 */
export type ConnectionStatus =
  | 'DISCONNECTED'
  | 'REQUESTING_PERMISSION'
  | 'CONNECTING'
  | 'INSPECTING'
  | 'DETECTING'
  | 'READING'
  | 'READY'
  | 'APPLYING'
  | 'VERIFYING'
  | 'ERROR'
  | 'DISCONNECTING';

/** What kind of session READY represents. */
export type SessionMode = 'supported' | 'unknown' | 'demo';

export type ConnectionEvent =
  | { type: 'REQUEST' }
  | { type: 'PERMISSION_GRANTED' }
  | { type: 'PERMISSION_DENIED'; message: string }
  | { type: 'OPEN_DEMO' }
  | { type: 'OPENED' }
  | { type: 'INSPECTED' }
  | { type: 'DETECTED'; mode: SessionMode }
  | { type: 'READ_DONE' }
  /** Unknown-device mode: the user allowed an identification handshake; detection runs again. */
  | { type: 'REIDENTIFY' }
  | { type: 'APPLY' }
  | { type: 'APPLY_SENT'; verify: boolean }
  | { type: 'VERIFY_DONE' }
  | { type: 'FAIL'; message: string; recoverable: boolean }
  | { type: 'DISCONNECT' }
  | { type: 'CLOSED' }
  /** Physical unplug, sleep, or a stale device handle. */
  | { type: 'LOST'; reason: string }
  | { type: 'RESET' };

export interface ConnectionState {
  status: ConnectionStatus;
  mode?: SessionMode;
  error?: string;
  /** Status to return to after a recoverable error (READY when a device is still open). */
  resumeTo?: ConnectionStatus;
}

export const INITIAL_CONNECTION: ConnectionState = { status: 'DISCONNECTED' };

type Handler = (s: ConnectionState, e: ConnectionEvent) => ConnectionState | undefined;

const TABLE: Record<ConnectionStatus, Handler> = {
  DISCONNECTED: (s, e) =>
    e.type === 'REQUEST'
      ? { status: 'REQUESTING_PERMISSION' }
      : e.type === 'OPEN_DEMO'
        ? { status: 'CONNECTING', mode: 'demo' }
        : undefined,
  REQUESTING_PERMISSION: (s, e) =>
    e.type === 'PERMISSION_GRANTED'
      ? { status: 'CONNECTING' }
      : e.type === 'PERMISSION_DENIED'
        ? { status: 'DISCONNECTED', error: e.message }
        : undefined,
  CONNECTING: (s, e) => (e.type === 'OPENED' ? { ...s, status: 'INSPECTING' } : undefined),
  INSPECTING: (s, e) => (e.type === 'INSPECTED' ? { ...s, status: 'DETECTING' } : undefined),
  DETECTING: (s, e) =>
    e.type === 'DETECTED'
      ? // Unknown devices skip READING: nothing is sent to them beyond descriptor inspection.
        e.mode === 'unknown'
        ? { status: 'READY', mode: 'unknown' }
        : { status: 'READING', mode: s.mode === 'demo' ? 'demo' : e.mode }
      : undefined,
  READING: (s, e) => (e.type === 'READ_DONE' ? { ...s, status: 'READY' } : undefined),
  READY: (s, e) =>
    e.type === 'APPLY'
      ? s.mode === 'unknown'
        ? undefined // Unknown-device mode never writes.
        : { ...s, status: 'APPLYING' }
      : e.type === 'READ_DONE'
        ? s
        : e.type === 'REIDENTIFY'
          ? // Unknown devices after consent; configurable devices after their adapter learned
            // something that changes their capabilities (a confirmed settings layout).
            { status: 'DETECTING', ...(s.mode === 'demo' ? { mode: 'demo' as const } : {}) }
          : undefined,
  APPLYING: (s, e) =>
    e.type === 'APPLY_SENT' ? { ...s, status: e.verify ? 'VERIFYING' : 'READY' } : undefined,
  VERIFYING: (s, e) => (e.type === 'VERIFY_DONE' ? { ...s, status: 'READY' } : undefined),
  ERROR: (s, e) =>
    e.type === 'RESET'
      ? s.resumeTo
        ? { status: s.resumeTo, ...(s.mode ? { mode: s.mode } : {}) }
        : { status: 'DISCONNECTED' }
      : undefined,
  DISCONNECTING: (_s, e) => (e.type === 'CLOSED' ? { status: 'DISCONNECTED' } : undefined),
};

/** True while a device handle is open. */
export function hasDevice(status: ConnectionStatus): boolean {
  return !['DISCONNECTED', 'REQUESTING_PERMISSION', 'DISCONNECTING', 'ERROR'].includes(status);
}

/**
 * Applies an event. Unknown transitions leave the state unchanged and are reported through
 * `onIgnored`, so a stray event (e.g. a late reply after unplug) can never trigger a write.
 */
export function transition(
  state: ConnectionState,
  event: ConnectionEvent,
  onIgnored?: (s: ConnectionState, e: ConnectionEvent) => void,
): ConnectionState {
  // Global events, valid from any state.
  if (event.type === 'LOST')
    return state.status === 'DISCONNECTED' ? state : { status: 'DISCONNECTED', error: event.reason };
  if (event.type === 'DISCONNECT')
    return state.status === 'DISCONNECTED' ? state : { status: 'DISCONNECTING' };
  if (event.type === 'FAIL') {
    const open = hasDevice(state.status) && event.recoverable;
    return {
      status: 'ERROR',
      error: event.message,
      ...(state.mode ? { mode: state.mode } : {}),
      ...(open ? { resumeTo: state.status === 'APPLYING' || state.status === 'VERIFYING' ? 'READY' : state.status } : {}),
    };
  }
  const next = TABLE[state.status](state, event);
  if (!next) {
    onIgnored?.(state, event);
    return state;
  }
  return next;
}

/** Writes are possible only from READY on a supported or demo session. */
export function canApply(state: ConnectionState): boolean {
  return state.status === 'READY' && (state.mode === 'supported' || state.mode === 'demo');
}

export function isBusy(status: ConnectionStatus): boolean {
  return ['REQUESTING_PERMISSION', 'CONNECTING', 'INSPECTING', 'DETECTING', 'READING', 'APPLYING', 'VERIFYING', 'DISCONNECTING'].includes(status);
}

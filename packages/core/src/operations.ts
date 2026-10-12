import { BusyError } from './errors.js';
import type { FeatureId } from './model/capabilities.js';
import type { TxOutcome } from './transaction.js';

/**
 * Lifecycle helpers shared by every front end: a session epoch so late answers from a previous
 * device are discarded, a single-flight lock so device-changing operations never overlap, and the
 * rules that turn edit and write state into one configuration status.
 */

/** Increments whenever the device session changes (connect, disconnect, unplug). */
export class SessionEpoch {
  private n = 0;
  get current(): number {
    return this.n;
  }
  /** Starts a new epoch; work tagged with an older one is stale. */
  next(): number {
    return ++this.n;
  }
  isCurrent(epoch: number): boolean {
    return epoch === this.n;
  }
}

export type OperationPhase = 'confirming' | 'writing' | 'verifying';

export interface Operation {
  id: number;
  /** Session epoch the operation belongs to. */
  epoch: number;
  label: string;
  feature?: FeatureId;
  phase: OperationPhase;
  startedAt: number;
}

/**
 * One device-changing operation at a time. A second request is refused (BusyError) instead of
 * queued: a queued write would run against state the user did not review. `abandon()` detaches the
 * lock from an operation whose device went away, so the UI never keeps a stale spinner.
 */
export class OperationLock {
  private active: Operation | null = null;
  private seq = 0;
  constructor(private readonly onChange: (op: Operation | null) => void = () => undefined) {}

  get current(): Operation | null {
    return this.active;
  }

  begin(epoch: number, label: string, phase: OperationPhase, feature?: FeatureId): Operation {
    if (this.active) throw new BusyError(this.active.label);
    this.active = {
      id: ++this.seq,
      epoch,
      label,
      phase,
      startedAt: Date.now(),
      ...(feature ? { feature } : {}),
    };
    this.onChange(this.active);
    return this.active;
  }

  /** Moves the operation to another phase; ignored when it is no longer the active one. */
  phase(op: Operation, phase: OperationPhase): void {
    if (this.active?.id !== op.id) return;
    this.active = { ...this.active, phase };
    this.onChange(this.active);
  }

  end(op: Operation): void {
    if (this.active?.id !== op.id) return;
    this.active = null;
    this.onChange(null);
  }

  abandon(): void {
    if (!this.active) return;
    this.active = null;
    this.onChange(null);
  }

  /** Runs `fn` under the lock; the lock is released however `fn` ends. */
  async run<T>(
    epoch: number,
    label: string,
    phase: OperationPhase,
    fn: (op: Operation) => Promise<T>,
    feature?: FeatureId,
  ): Promise<T> {
    const op = this.begin(epoch, label, phase, feature);
    try {
      return await fn(op);
    } finally {
      this.end(op);
    }
  }
}

/**
 * What an editor shows about its configuration, in the words of the brief:
 * - clean: matches what was last read or written.
 * - modified: edited locally, not written.
 * - saving / verifying: being written / being read back.
 * - verified: written and read back equal.
 * - saved-unverified: written and acknowledged; the device cannot report the value.
 * - mismatch: written, but the device reports something else.
 * - failed: the write failed; the device state is unknown.
 * - reverted: local edits were discarded.
 */
export type ConfigStatus =
  | 'clean'
  | 'modified'
  | 'saving'
  | 'verifying'
  | 'verified'
  | 'saved-unverified'
  | 'mismatch'
  | 'failed'
  | 'reverted';

export interface ConfigStatusInput {
  /** Local draft differs from the last applied state. */
  dirty: boolean;
  /** The editor's own write, if one is running. */
  phase?: OperationPhase | null;
  /** Outcome of this editor's last write, cleared by the next local edit. */
  lastOutcome?: TxOutcome | null;
  /** The last action was Discard. */
  reverted?: boolean;
}

export function configStatus(s: ConfigStatusInput): ConfigStatus {
  if (s.phase === 'writing' || s.phase === 'confirming') return 'saving';
  if (s.phase === 'verifying') return 'verifying';
  // A failure stays visible while the failed edits are still pending: the device state is unknown.
  if (s.lastOutcome === 'FAILED') return 'failed';
  if (s.lastOutcome === 'MISMATCH') return 'mismatch';
  if (s.dirty) return 'modified';
  if (s.lastOutcome === 'VERIFIED') return 'verified';
  if (s.lastOutcome === 'SENT_UNVERIFIED') return 'saved-unverified';
  if (s.reverted) return 'reverted';
  return 'clean';
}

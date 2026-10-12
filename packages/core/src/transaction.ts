import { diffValues } from './diff.js';
import type { Change } from './diff.js';
import { explainError } from './errors.js';

/**
 * READ → LOCAL EDIT → VALIDATE → DIFF → APPLY → ACK → READBACK → VERIFY.
 * The local edit happens in the UI; this module runs the rest and reports honestly what was proven.
 */
export type TxPhase = 'validate' | 'diff' | 'apply' | 'ack' | 'readback' | 'verify';

export type TxOutcome =
  /** Read back from the device and equal to what was written. */
  | 'VERIFIED'
  /** Written and acknowledged, but the device cannot report the value. */
  | 'SENT_UNVERIFIED'
  /** Read back from the device and different from what was written. */
  | 'MISMATCH'
  /** Nothing to write. */
  | 'NO_CHANGES'
  /** Validation failed; nothing was sent. */
  | 'REJECTED'
  /** The write or the read-back threw. */
  | 'FAILED';

export interface TxStep {
  phase: TxPhase;
  ok: boolean;
  detail: string;
  ms: number;
}

export interface TxResult<T> {
  outcome: TxOutcome;
  /** User-facing summary; never says "verified" unless outcome is VERIFIED. */
  message: string;
  changes: Change[];
  steps: TxStep[];
  /** Differences between what was written and what was read back (MISMATCH only). */
  mismatches?: Change[];
  readback?: T;
  error?: { title: string; detail: string };
}

export interface Transaction<T> {
  label: string;
  /** Returns validation errors; an empty list means the value may be written. */
  validate?(next: T): string[];
  /**
   * Sends the value. Resolves when the protocol's acknowledgement was received (or, for protocols
   * without acknowledgements, when the report was handed to the OS; see `acknowledged`).
   */
  apply(next: T): Promise<void>;
  /** True when `apply` resolving means the device acknowledged the write. */
  acknowledged: boolean;
  /**
   * Reads the value back **from the device**. Omit when the firmware cannot report it; never pass
   * a function that returns a locally remembered copy, because that would fake verification.
   */
  readbackFromDevice?(): Promise<T>;
  /** Normalises a value before comparison (e.g. drops fields the device does not store). */
  normalize?(value: T): unknown;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function runTransaction<T>(
  tx: Transaction<T>,
  previous: T | undefined,
  next: T,
  onStep?: (s: TxStep) => void,
): Promise<TxResult<T>> {
  const steps: TxStep[] = [];
  const step = (phase: TxPhase, ok: boolean, detail: string, t0: number): void => {
    const s = { phase, ok, detail, ms: Math.round(now() - t0) };
    steps.push(s);
    onStep?.(s);
  };
  const norm = (v: T | undefined): unknown =>
    v === undefined ? undefined : tx.normalize ? tx.normalize(v) : v;

  let t = now();
  const errors = tx.validate?.(next) ?? [];
  step('validate', errors.length === 0, errors.length ? errors.join('; ') : 'valid', t);
  if (errors.length)
    return {
      outcome: 'REJECTED',
      message: `${tx.label}: not sent — ${errors.join('; ')}`,
      changes: [],
      steps,
    };

  t = now();
  const changes =
    previous === undefined
      ? diffValues(undefined, norm(next))
      : diffValues(norm(previous), norm(next));
  step('diff', true, `${changes.length} change(s)`, t);
  if (previous !== undefined && changes.length === 0)
    return { outcome: 'NO_CHANGES', message: `${tx.label}: nothing to apply.`, changes, steps };

  t = now();
  try {
    await tx.apply(next);
    step('apply', true, 'sent', t);
  } catch (e) {
    step('apply', false, e instanceof Error ? e.message : String(e), t);
    const x = explainError(e);
    return {
      outcome: 'FAILED',
      message: `${tx.label}: ${x.title}`,
      changes,
      steps,
      error: { title: x.title, detail: x.detail },
    };
  }
  step(
    'ack',
    tx.acknowledged,
    tx.acknowledged ? 'device acknowledged' : 'protocol has no acknowledgement',
    now(),
  );

  if (!tx.readbackFromDevice) {
    return {
      outcome: 'SENT_UNVERIFIED',
      message: `${tx.label}: write sent; verification unavailable (the device cannot report this value).`,
      changes,
      steps,
    };
  }

  t = now();
  let readback: T;
  try {
    readback = await tx.readbackFromDevice();
    step('readback', true, 'read from device', t);
  } catch (e) {
    step('readback', false, e instanceof Error ? e.message : String(e), t);
    const x = explainError(e);
    return {
      outcome: 'FAILED',
      message: `${tx.label}: write sent, but reading it back failed — ${x.title}`,
      changes,
      steps,
      error: { title: x.title, detail: x.detail },
    };
  }

  t = now();
  const mismatches = diffValues(norm(next), norm(readback));
  step(
    'verify',
    mismatches.length === 0,
    mismatches.length ? `${mismatches.length} difference(s)` : 'read-back matches',
    t,
  );
  if (mismatches.length)
    return {
      outcome: 'MISMATCH',
      message: `${tx.label}: the device reports different values than were written (${mismatches.length} difference(s)).`,
      changes,
      steps,
      mismatches,
      readback,
    };
  return {
    outcome: 'VERIFIED',
    message: `${tx.label}: verified by read-back.`,
    changes,
    steps,
    readback,
  };
}

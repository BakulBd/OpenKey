/**
 * Immutable undo/redo history for local edits. Hardware writes never clear it: `markApplied` only
 * records which state was last written, so the user can still undo past an Apply.
 */
export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  /** The state last written to the device, or the state read from it. */
  readonly applied: T;
  readonly limit: number;
}

export function createHistory<T>(initial: T, limit = 100): History<T> {
  return { past: [], present: initial, future: [], applied: initial, limit };
}

export function pushHistory<T>(h: History<T>, next: T): History<T> {
  if (Object.is(next, h.present)) return h;
  const past = [...h.past, h.present];
  return { ...h, past: past.slice(Math.max(0, past.length - h.limit)), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { ...h, past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { ...h, past: [...h.past, h.present], present: next, future: rest };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

export function markApplied<T>(h: History<T>, applied: T = h.present): History<T> {
  return { ...h, applied };
}

/** Replaces everything, e.g. after reading fresh state from a newly connected device. */
export function resetHistory<T>(h: History<T>, state: T): History<T> {
  return createHistory(state, h.limit);
}

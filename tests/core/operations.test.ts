import { describe, expect, it } from 'vitest';
import { OperationLock, SessionEpoch, configStatus, isOpenKeyError } from '@openkey/core';
import type { Operation } from '@openkey/core';

describe('session epoch', () => {
  it('marks work from a previous session as stale', () => {
    const e = new SessionEpoch();
    const a = e.next();
    expect(e.isCurrent(a)).toBe(true);
    e.next(); // disconnect or a new device
    expect(e.isCurrent(a)).toBe(false);
  });
});

describe('operation lock', () => {
  it('refuses a second operation instead of queueing it', async () => {
    const seen: (Operation | null)[] = [];
    const lock = new OperationLock((op) => seen.push(op));
    let release!: () => void;
    const first = lock.run(1, 'keymap', 'writing', () => new Promise<void>((r) => (release = r)));
    await expect(lock.run(1, 'lighting', 'writing', async () => 'x')).rejects.toSatisfy(
      (e) => isOpenKeyError(e) && e.code === 'BUSY',
    );
    release();
    await first;
    expect(lock.current).toBeNull();
    expect(await lock.run(1, 'lighting', 'writing', async () => 'ok')).toBe('ok');
    expect(seen.filter((x) => x === null).length).toBe(2);
  });

  it('releases on failure, so a failed write never leaves a permanent spinner', async () => {
    const lock = new OperationLock();
    await expect(
      lock.run(1, 'x', 'writing', async () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(lock.current).toBeNull();
  });

  it('abandon() drops a stale operation, and its late end() cannot clear a newer one', async () => {
    const lock = new OperationLock();
    const old = lock.begin(1, 'old', 'writing');
    lock.abandon(); // device unplugged
    const fresh = lock.begin(2, 'new', 'writing');
    lock.end(old);
    lock.phase(old, 'verifying');
    expect(lock.current).toEqual(fresh);
  });
});

describe('configuration status', () => {
  it('never says saved for a local edit', () => {
    expect(configStatus({ dirty: true })).toBe('modified');
    expect(configStatus({ dirty: true, lastOutcome: 'VERIFIED' })).toBe('modified');
  });
  it('distinguishes verified, unverified, mismatch and failure', () => {
    expect(configStatus({ dirty: false, lastOutcome: 'VERIFIED' })).toBe('verified');
    expect(configStatus({ dirty: false, lastOutcome: 'SENT_UNVERIFIED' })).toBe('saved-unverified');
    expect(configStatus({ dirty: false, lastOutcome: 'MISMATCH' })).toBe('mismatch');
    expect(configStatus({ dirty: true, lastOutcome: 'FAILED' })).toBe('failed');
  });
  it('reports the running phase first', () => {
    expect(configStatus({ dirty: true, phase: 'writing' })).toBe('saving');
    expect(configStatus({ dirty: true, phase: 'verifying' })).toBe('verifying');
  });
  it('reports a discard', () => {
    expect(configStatus({ dirty: false, reverted: true })).toBe('reverted');
  });
});

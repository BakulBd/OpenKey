import { describe, expect, it } from 'vitest';
import {
  Evidence,
  FeatureStatus,
  INITIAL_CONNECTION,
  SafetyLevel,
  TransportError,
  buildSupportBundle,
  cadenceStats,
  canApply,
  canRedo,
  canUndo,
  configurable,
  createHistory,
  diffValues,
  emptyCapabilities,
  explainError,
  feature,
  markApplied,
  mayWrite,
  navigationMode,
  pushHistory,
  redo,
  runTransaction,
  statusFromSource,
  transition,
  undo,
  writeDecision,
} from '@openkey/core';
import type { ConnectionEvent, ConnectionState, Transaction } from '@openkey/core';

describe('evidence', () => {
  it('only hardware evidence yields VERIFIED', () => {
    expect(statusFromSource('hardware-verification')).toBe(Evidence.VERIFIED);
    expect(statusFromSource('controlled-experiment')).toBe(Evidence.VERIFIED);
    expect(statusFromSource('official-driver')).toBe(Evidence.OBSERVED);
    expect(statusFromSource('public-reverse-engineering')).toBe(Evidence.INFERRED);
  });
});

describe('capabilities', () => {
  it('a write without device read-back is WRITE_ONLY, never SUPPORTED', () => {
    expect(configurable('mirror', true, Evidence.VERIFIED).status).toBe(FeatureStatus.WRITE_ONLY);
    expect(configurable('none', true, Evidence.OBSERVED).status).toBe(FeatureStatus.WRITE_ONLY);
    expect(configurable('device', true, Evidence.VERIFIED).status).toBe(FeatureStatus.SUPPORTED);
    expect(configurable('device', true, Evidence.OBSERVED).status).toBe(FeatureStatus.CONFIGURABLE);
  });

  it('a present but unreverse-engineered screen is shown as research, not hidden', () => {
    expect(navigationMode(feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED))).toBe('research');
    expect(navigationMode(feature(FeatureStatus.NOT_SUPPORTED))).toBe('hide');
    expect(navigationMode(feature(FeatureStatus.UNKNOWN))).toBe('hide');
    expect(navigationMode(configurable('device', true, Evidence.OBSERVED))).toBe('show');
  });

  it('defaults every capability to UNKNOWN', () => {
    const caps = emptyCapabilities();
    expect(Object.values(caps).every((c) => c.status === FeatureStatus.UNKNOWN && !c.write)).toBe(true);
  });
});

describe('safety policy', () => {
  const real = { simulated: false, experimentalEnabled: false };
  it('allows verified safe writes', () => {
    const s = configurable('device', true, Evidence.VERIFIED, { safety: SafetyLevel.SAFE_PERSISTENT });
    expect(writeDecision(s, real).kind).toBe('allowed');
  });
  it('makes unverified writes experimental (opt-in)', () => {
    const s = configurable('mirror', true, Evidence.OBSERVED, { safety: SafetyLevel.CAUTION });
    const d = writeDecision(s, real);
    expect(d.kind).toBe('experimental');
    expect(mayWrite(d, real)).toBe(false);
    expect(mayWrite(d, { ...real, experimentalEnabled: true })).toBe(true);
  });
  it('blocks hypotheses and unsafe operations even with the opt-in', () => {
    const opt = { simulated: false, experimentalEnabled: true };
    expect(writeDecision(configurable('none', true, Evidence.HYPOTHESIS), opt).kind).toBe('blocked');
    expect(
      writeDecision(configurable('none', true, Evidence.VERIFIED, { safety: SafetyLevel.UNSAFE }), {
        simulated: true,
        experimentalEnabled: true,
      }).kind,
    ).toBe('blocked');
  });
  it('allows everything but UNSAFE on a simulator', () => {
    const s = configurable('mirror', true, Evidence.OBSERVED, { safety: SafetyLevel.HIGH_RISK });
    expect(writeDecision(s, { simulated: true, experimentalEnabled: false }).kind).toBe('allowed');
  });
});

describe('diff', () => {
  it('reports leaf changes independent of key order', () => {
    expect(diffValues({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 3] }, a: 1 })).toEqual([
      { path: 'b.c[1]', before: 2, after: 3 },
    ]);
    expect(diffValues(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toEqual([]);
  });
});

describe('transaction', () => {
  const tx = (over: Partial<Transaction<{ v: number }>> = {}): Transaction<{ v: number }> => {
    let stored = { v: 0 };
    return {
      label: 'Set v',
      acknowledged: true,
      apply: async (n) => {
        stored = n;
      },
      readbackFromDevice: async () => stored,
      ...over,
    };
  };

  it('verifies by read-back', async () => {
    const r = await runTransaction(tx(), { v: 0 }, { v: 1 });
    expect(r.outcome).toBe('VERIFIED');
    expect(r.steps.map((s) => s.phase)).toEqual(['validate', 'diff', 'apply', 'ack', 'readback', 'verify']);
  });

  it('never claims verification without a device read-back', async () => {
    const r = await runTransaction(tx({ readbackFromDevice: undefined }), { v: 0 }, { v: 1 });
    expect(r.outcome).toBe('SENT_UNVERIFIED');
    expect(r.message).toMatch(/verification unavailable/);
    expect(r.message).not.toMatch(/verified by/);
  });

  it('detects a read-back mismatch', async () => {
    const r = await runTransaction(tx({ readbackFromDevice: async () => ({ v: 7 }) }), { v: 0 }, { v: 1 });
    expect(r.outcome).toBe('MISMATCH');
    expect(r.mismatches).toEqual([{ path: 'v', before: 1, after: 7 }]);
  });

  it('sends nothing on validation errors or when unchanged', async () => {
    let sent = false;
    const t = tx({ apply: async () => void (sent = true), validate: (n) => (n.v > 5 ? ['too big'] : []) });
    expect((await runTransaction(t, { v: 0 }, { v: 9 })).outcome).toBe('REJECTED');
    expect((await runTransaction(t, { v: 1 }, { v: 1 })).outcome).toBe('NO_CHANGES');
    expect(sent).toBe(false);
  });

  it('reports a failed write', async () => {
    const r = await runTransaction(
      tx({ apply: async () => Promise.reject(new TransportError('stall')) }),
      { v: 0 },
      { v: 1 },
    );
    expect(r.outcome).toBe('FAILED');
    expect(r.error?.title).toBe('Communication failed');
  });
});

describe('history', () => {
  it('undo/redo survive an applied write', () => {
    let h = createHistory('a');
    h = pushHistory(h, 'b');
    h = pushHistory(h, 'c');
    h = markApplied(h);
    expect(h.applied).toBe('c');
    h = undo(h);
    expect(h.present).toBe('b');
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe('c');
    expect(canUndo(h)).toBe(true);
  });
  it('respects the limit and clears redo on a new edit', () => {
    let h = createHistory(0, 3);
    for (let i = 1; i <= 10; i++) h = pushHistory(h, i);
    expect(h.past).toEqual([7, 8, 9]);
    h = pushHistory(undo(h), 42);
    expect(h.future).toEqual([]);
  });
});

describe('connection state machine', () => {
  const run = (events: ConnectionEvent[], from: ConnectionState = INITIAL_CONNECTION) =>
    events.reduce((s, e) => transition(s, e), from);
  const connectSupported: ConnectionEvent[] = [
    { type: 'REQUEST' },
    { type: 'PERMISSION_GRANTED' },
    { type: 'OPENED' },
    { type: 'INSPECTED' },
    { type: 'DETECTED', mode: 'supported' },
    { type: 'READ_DONE' },
  ];

  it('reaches READY and can apply', () => {
    const s = run(connectSupported);
    expect(s).toEqual({ status: 'READY', mode: 'supported' });
    expect(canApply(s)).toBe(true);
    expect(run([{ type: 'APPLY' }, { type: 'APPLY_SENT', verify: true }], s).status).toBe('VERIFYING');
  });

  it('unknown devices skip reading and can never apply', () => {
    const s = run([...connectSupported.slice(0, 4), { type: 'DETECTED', mode: 'unknown' }]);
    expect(s).toEqual({ status: 'READY', mode: 'unknown' });
    expect(canApply(s)).toBe(false);
    expect(transition(s, { type: 'APPLY' })).toBe(s);
  });

  it('unplug drops to DISCONNECTED and a reconnect never resumes a write', () => {
    const applying = run([...connectSupported, { type: 'APPLY' }]);
    const lost = transition(applying, { type: 'LOST', reason: 'unplugged' });
    expect(lost.status).toBe('DISCONNECTED');
    const back = run(connectSupported, lost);
    expect(back.status).toBe('READY');
  });

  it('only an unknown-device session can re-run identification, and it cannot jump to APPLYING', () => {
    const unknown = run([...connectSupported.slice(0, 4), { type: 'DETECTED', mode: 'unknown' }]);
    const again = transition(unknown, { type: 'REIDENTIFY' });
    expect(again.status).toBe('DETECTING');
    expect(transition(again, { type: 'APPLY' }).status).toBe('DETECTING');
    const supported = run(connectSupported);
    expect(transition(supported, { type: 'REIDENTIFY' })).toBe(supported);
  });

  it('ignores stray events', () => {
    const ignored: string[] = [];
    const s = transition(INITIAL_CONNECTION, { type: 'APPLY' }, (_s, e) => ignored.push(e.type));
    expect(s).toBe(INITIAL_CONNECTION);
    expect(ignored).toEqual(['APPLY']);
  });

  it('a recoverable error during apply returns to READY on reset', () => {
    const s = run([...connectSupported, { type: 'APPLY' }, { type: 'FAIL', message: 'timeout', recoverable: true }]);
    expect(s.status).toBe('ERROR');
    expect(transition(s, { type: 'RESET' }).status).toBe('READY');
  });
});

describe('cadence statistics', () => {
  it('measures intervals and counts missed reports against the declared interval', () => {
    const ts = [0, 1, 2, 3, 6, 7, 8];
    const s = cadenceStats(ts, 1)!;
    expect(s.medianMs).toBe(1);
    expect(s.maxMs).toBe(3);
    expect(s.missed).toBe(1);
    expect(s.measuredRateHz).toBe(1000);
  });
  it('needs two samples', () => {
    expect(cadenceStats([5])).toBeNull();
  });
});

describe('support bundle', () => {
  it('redacts the serial number unless opted in and lists exclusions', () => {
    const b = buildSupportBundle({
      environment: { appVersion: '0.2.0', userAgent: 'x', platform: 'Linux', webHid: true, secureContext: true },
      device: { vendorId: '0x0C45', productId: '0x8009', productName: 'AK820 MAX', serialNumber: 'SECRET', interfaces: [] },
      connectionState: 'READY',
      recentErrors: [{ at: 't', kind: 'TIMEOUT', title: 'x' }],
    });
    expect(JSON.stringify(b)).not.toContain('SECRET');
    expect(b.device?.serialRedacted).toBe(true);
    expect(b.excluded).toContain('typing data');
  });
});

describe('error explanations', () => {
  it('maps WebHID DOMExceptions to actionable messages', () => {
    const inUse = explainError(Object.assign(new Error('Failed to open the device.'), { name: 'InvalidStateError' }));
    expect(inUse.kind).toBe('DEVICE_IN_USE');
    expect(inUse.hint).toBeTruthy();
    expect(explainError(Object.assign(new Error('x'), { name: 'NotAllowedError' })).kind).toBe('PERMISSION');
    expect(explainError(new Error('boom')).kind).toBe('UNEXPECTED');
  });
});

import { describe, expect, it } from 'vitest';
import { INITIAL_CONNECTION } from '@openkey/core';
import type { ConnectionState } from '@openkey/core';
import { summarize } from '../../apps/web/src/state/status.js';

const ready = (mode: ConnectionState['mode']): ConnectionState => ({ status: 'READY', mode });

describe('status summary', () => {
  it('nothing connected', () => {
    expect(summarize(INITIAL_CONNECTION, null, null)).toMatchObject({ mode: 'none', configurable: false, headline: 'status.none' });
  });

  it('detection in progress is never shown as connected', () => {
    expect(summarize({ status: 'DETECTING' }, null, null)).toMatchObject({ mode: 'connecting', headline: 'status.identifying' });
    // Re-identification after consent: the old unknown session is still there, but not "ready".
    const s = summarize({ status: 'DETECTING' }, { kind: 'unknown', verdict: { kind: 'STRONG_CANDIDATE' } }, null);
    expect(s).toMatchObject({ mode: 'connecting', configurable: false });
  });

  it('a simulator is never verified hardware, whatever its verdict says', () => {
    const s = summarize(ready('demo'), { kind: 'device', demo: true, verdict: { kind: 'SIMULATED' } }, null);
    expect(s).toMatchObject({ mode: 'simulated', identity: 'simulated', headline: 'status.simulated' });
    const odd = summarize(ready('demo'), { kind: 'device', demo: true, verdict: { kind: 'VERIFIED_MATCH' } }, null);
    expect(odd.mode).toBe('simulated');
  });

  it('hardware: verified vs identified', () => {
    expect(summarize(ready('supported'), { kind: 'device', verdict: { kind: 'VERIFIED_MATCH' } }, null)).toMatchObject({ mode: 'hardware', identity: 'verified', tone: 'ok' });
    expect(summarize(ready('supported'), { kind: 'device', verdict: { kind: 'FIRMWARE_UNVERIFIED' } }, null)).toMatchObject({ identity: 'identified', headline: 'status.identified' });
  });

  it('inspection-only sessions are not configurable and name the reason', () => {
    const cases = [
      ['STRONG_CANDIDATE', 'status.candidate'],
      ['FAMILY_CANDIDATE', 'status.candidate'],
      ['AMBIGUOUS', 'status.ambiguous'],
      ['TRANSPORT_UNSUPPORTED', 'status.readOnlyTransport'],
      ['UNKNOWN', 'status.unknown'],
      ['INSPECT_ONLY', 'status.unknown'],
    ] as const;
    for (const [kind, headline] of cases) {
      const s = summarize(ready('unknown'), { kind: 'unknown', verdict: { kind } }, null);
      expect(s, kind).toMatchObject({ mode: 'inspect', configurable: false, headline });
    }
  });
});

import { fromHex } from '@openak820/core';
import type { MockBehavior } from './mock.js';

export interface RecordedPacket {
  kind: 'feature-set' | 'feature-get' | 'output' | 'input';
  hex: string;
}

/**
 * Replays a recorded exchange: host writes must match the recording byte-for-byte, reads return
 * the recorded device responses in order. Used to turn hardware captures into regression tests.
 */
export function replayBehavior(packets: RecordedPacket[]): MockBehavior & { remaining(): number } {
  const queue = [...packets];
  const next = (kind: RecordedPacket['kind']): RecordedPacket => {
    const p = queue.shift();
    if (!p) throw new Error(`replay: unexpected ${kind} after end of recording`);
    if (p.kind !== kind) throw new Error(`replay: expected ${p.kind} but host did ${kind}`);
    return p;
  };
  return {
    onFeatureSet(_id, data) {
      const p = next('feature-set');
      const want = fromHex(p.hex);
      if (want.length !== data.length || want.some((b, i) => b !== data[i])) {
        throw new Error(
          `replay: host sent ${Array.from(data.subarray(0, 12), (b) => b.toString(16).padStart(2, '0')).join(' ')}… but recording has ${p.hex.slice(0, 36)}…`,
        );
      }
    },
    onFeatureGet() {
      return fromHex(next('feature-get').hex);
    },
    remaining: () => queue.length,
  };
}

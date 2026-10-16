import { describe, expect, it } from 'vitest';
import {
  Evidence,
  SafetyLevel,
  configurable,
  emptyCapabilities,
  explainError,
  explainForLink,
  linkSummary,
  TimeoutError,
} from '@openkey/core';

const off = { simulated: false, experimentalEnabled: false };
const on = { simulated: false, experimentalEnabled: true };

function caps(evidence: Evidence | null) {
  const c = emptyCapabilities();
  if (evidence)
    c.rgb = configurable('device', true, evidence, { safety: SafetyLevel.SAFE_PERSISTENT });
  return c;
}

describe('what the connection allows', () => {
  it('a wired keyboard with verified writes has no limits', () => {
    expect(linkSummary(caps(Evidence.VERIFIED), 'usb', off).limits).toEqual([]);
  });

  it('a receiver with nothing writable is read-only, and says the cable is needed', () => {
    expect(linkSummary(caps(null), '2.4ghz', off).limits).toEqual(['wireless-read-only']);
  });

  it('a wireless link with some writes is partial', () => {
    expect(linkSummary(caps(Evidence.VERIFIED), 'bluetooth', off).limits).toEqual([
      'wireless-partial',
    ]);
  });

  it('a wired keyboard without any write path is read-only', () => {
    expect(linkSummary(caps(null), 'usb', off).limits).toEqual(['read-only']);
  });

  it('unverified writes wait for the experimental switch, and stop waiting once it is on', () => {
    expect(linkSummary(caps(Evidence.OBSERVED), 'usb', off)).toMatchObject({
      limits: ['experimental-only'],
      experimental: 1,
    });
    expect(linkSummary(caps(Evidence.OBSERVED), 'usb', on).limits).toEqual([]);
  });

  it('explains timeouts on a receiver or Bluetooth as a link problem, not a broken keyboard', () => {
    const x = explainError(new TimeoutError('No reply'));
    expect(explainForLink(x, 'usb')).toEqual(x);
    expect(explainForLink(x, '2.4ghz').hint).toMatch(/wake the keyboard/);
    expect(explainForLink(x, 'bluetooth').hint).toMatch(/USB cable/);
    const permission = explainError(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    expect(explainForLink(permission, '2.4ghz')).toEqual(permission);
  });
});

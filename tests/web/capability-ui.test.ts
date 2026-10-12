import { describe, expect, it } from 'vitest';
import {
  Evidence,
  FeatureStatus,
  SafetyLevel,
  configurable,
  emptyCapabilities,
  feature,
} from '@openkey/core';
import {
  bestUiState,
  featureUiState,
  isActionable,
} from '../../apps/web/src/state/capability-ui.js';

const real = { simulated: false, experimentalEnabled: false };

describe('capability presentation', () => {
  it('verified safe writes are ready; unverified ones experimental, even with the opt-in on', () => {
    expect(
      featureUiState(
        configurable('device', true, Evidence.VERIFIED, { safety: SafetyLevel.SAFE_PERSISTENT }),
        real,
      ),
    ).toBe('ready');
    const observed = configurable('mirror', true, Evidence.OBSERVED, {
      safety: SafetyLevel.CAUTION,
    });
    expect(featureUiState(observed, real)).toBe('experimental');
    expect(featureUiState(observed, { simulated: false, experimentalEnabled: true })).toBe(
      'experimental',
    );
  });

  it('never upgrades a feature without evidence', () => {
    const hypothesis = configurable('device', true, Evidence.HYPOTHESIS, {
      safety: SafetyLevel.SAFE_PERSISTENT,
    });
    expect(featureUiState(hypothesis, real)).toBe('readOnly');
    expect(featureUiState(feature(FeatureStatus.UNKNOWN), real)).toBe('unknown');
  });

  it('names why a present feature cannot be configured', () => {
    expect(featureUiState(feature(FeatureStatus.PHYSICALLY_PRESENT), real)).toBe('hardwareOnly');
    expect(featureUiState(feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED), real)).toBe(
      'research',
    );
    expect(featureUiState(feature(FeatureStatus.TRANSPORT_LIMITED), real)).toBe('transport');
    expect(featureUiState(feature(FeatureStatus.FIRMWARE_LIMITED), real)).toBe('firmware');
    expect(featureUiState(feature(FeatureStatus.NOT_SUPPORTED), real)).toBe('unsupported');
  });

  it('a page is as available as its best feature; only usable states are actionable', () => {
    const caps = emptyCapabilities();
    caps.tft = configurable('none', true, Evidence.OBSERVED, { safety: SafetyLevel.HIGH_RISK });
    caps.tftBuiltIn = feature(FeatureStatus.NOT_YET_REVERSE_ENGINEERED);
    expect(bestUiState(caps, ['tftBuiltIn', 'tft'], real)).toBe('experimental');
    expect(isActionable('experimental')).toBe(true);
    expect(isActionable('research')).toBe(false);
  });
});

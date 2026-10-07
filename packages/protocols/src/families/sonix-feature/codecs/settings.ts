import type { SettingsSchema, SystemSettings } from '@openkey/core';
import { PACKET_SIZE } from '../constants.js';
import { withTrailer } from '../frame.js';

/**
 * Settings data packet (FUN_00414060), sent after `04 17 01 … [8]=01`:
 *   [0]=00 [1]=01 [2]=disable Alt+Tab [3]=disable Alt+F4 [4]=disable Win key
 *   [5]=fn_switch [6]=sleep_time [7]=00 [8]=key_respondtime … [62..63]=AA 55
 * Checkbox → byte mapping from control creation FUN_0043c200 (language ids 160/161/162).
 */
export const SETTINGS_OFFSETS = {
  disableAltTab: 2,
  disableAltF4: 3,
  disableWinKey: 4,
  fnSwitch: 5,
  sleepTime: 6,
  keyResponseTime: 8,
} as const;

export const SETTINGS_SUB = 0x01;
export const SETTINGS_ENABLE = 0x01;

/** Combo-box item data from FUN_0043b6xx (language ids 142–145 and 600–624). */
export const SETTINGS_SCHEMA: SettingsSchema = {
  sleepTime: [
    { value: 0, label: 'Never' },
    { value: 1, label: '1 minute' },
    { value: 2, label: '5 minutes' },
    { value: 3, label: '30 minutes' },
  ],
  keyResponseTime: [
    { value: 1, label: 'Level 1 (≈2–3 ms wired)' },
    { value: 2, label: 'Level 2 (≈5–6 ms wired)' },
    { value: 3, label: 'Level 3 (≈8–9 ms wired)' },
    { value: 4, label: 'Level 4 (≈13–14 ms wired)' },
    { value: 5, label: 'Level 5 (≈17–18 ms wired)' },
  ],
};

export const DEFAULT_SETTINGS: Required<
  Pick<
    SystemSettings,
    | 'sleepTime'
    | 'keyResponseTime'
    | 'fnSwitch'
    | 'disableWinKey'
    | 'disableAltTab'
    | 'disableAltF4'
  >
> = {
  sleepTime: 0,
  keyResponseTime: 1,
  fnSwitch: 0,
  disableWinKey: false,
  disableAltTab: false,
  disableAltF4: false,
};

export function encodeSettingsData(s: SystemSettings): Uint8Array {
  const v = { ...DEFAULT_SETTINGS, ...s };
  const p = new Uint8Array(PACKET_SIZE);
  p[0] = 0x00;
  p[1] = 0x01;
  p[SETTINGS_OFFSETS.disableAltTab] = v.disableAltTab ? 1 : 0;
  p[SETTINGS_OFFSETS.disableAltF4] = v.disableAltF4 ? 1 : 0;
  p[SETTINGS_OFFSETS.disableWinKey] = v.disableWinKey ? 1 : 0;
  p[SETTINGS_OFFSETS.fnSwitch] = v.fnSwitch & 0xff;
  p[SETTINGS_OFFSETS.sleepTime] = v.sleepTime & 0xff;
  p[SETTINGS_OFFSETS.keyResponseTime] = v.keyResponseTime & 0xff;
  return withTrailer(p);
}

export function decodeSettingsData(p: Uint8Array): SystemSettings {
  return {
    disableAltTab: p[SETTINGS_OFFSETS.disableAltTab] === 1,
    disableAltF4: p[SETTINGS_OFFSETS.disableAltF4] === 1,
    disableWinKey: p[SETTINGS_OFFSETS.disableWinKey] === 1,
    fnSwitch: p[SETTINGS_OFFSETS.fnSwitch] ?? 0,
    sleepTime: p[SETTINGS_OFFSETS.sleepTime] ?? 0,
    keyResponseTime: p[SETTINGS_OFFSETS.keyResponseTime] ?? 0,
  };
}

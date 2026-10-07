import { Confidence } from '../confidence.js';

export const FEATURES = [
  'deviceInfo',
  'keymap',
  'fnLayer',
  'macros',
  'rgb',
  'perKeyRgb',
  'realtimeRgb',
  'tft',
  'tftGif',
  'tftClock',
  'tftBuiltIn',
  'battery',
  'knob',
  'pollingRate',
  'gameMode',
  'winLock',
  'altLocks',
  'sleep',
  'keyResponse',
  'factoryDefaults',
] as const;

export type FeatureId = (typeof FEATURES)[number];

/**
 * What OpenAK820 knows about a feature. "Not implemented yet" is never reported as "not supported":
 * - CONFIGURABLE: read and/or write implemented.
 * - SUPPORTED_READ_ONLY: the value can be read, not changed.
 * - SUPPORTED_FIXED: exists with a fixed value (e.g. polling rate 1000 Hz, not adjustable).
 * - PHYSICALLY_PRESENT_NOT_PROGRAMMABLE: hardware exists, works through standard HID, no config protocol.
 * - NOT_YET_REVERSE_ENGINEERED: the hardware likely supports it; the protocol is unknown.
 * - NOT_SUPPORTED: evidence shows the device/link does not offer it.
 * - UNKNOWN: no evidence either way.
 */
export const FeatureStatus = {
  CONFIGURABLE: 'CONFIGURABLE',
  SUPPORTED_READ_ONLY: 'SUPPORTED_READ_ONLY',
  SUPPORTED_FIXED: 'SUPPORTED_FIXED',
  PHYSICALLY_PRESENT_NOT_PROGRAMMABLE: 'PHYSICALLY_PRESENT_NOT_PROGRAMMABLE',
  NOT_YET_REVERSE_ENGINEERED: 'NOT_YET_REVERSE_ENGINEERED',
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  UNKNOWN: 'UNKNOWN',
} as const;
export type FeatureStatus = (typeof FeatureStatus)[keyof typeof FeatureStatus];

/**
 * Where reads come from:
 * - `device`: the firmware returns the value.
 * - `mirror`: the firmware is write-only for this feature; OpenAK820 shows what it last wrote.
 * - `none`: not readable at all.
 */
export type ReadSource = 'device' | 'mirror' | 'none';

export interface FeatureSupport {
  status: FeatureStatus;
  read: ReadSource;
  write: boolean;
  confidence: Confidence;
  /** Short human value for fixed/read-only features, e.g. "1000 Hz" or "Volume ±, Mute". */
  value?: string;
  note?: string;
  /** Where the information comes from (official driver function, hardware observation …). */
  source?: string;
}

export type Capabilities = Record<FeatureId, FeatureSupport>;

export function feature(
  status: FeatureStatus,
  init: Partial<Omit<FeatureSupport, 'status'>> = {},
): FeatureSupport {
  return { status, read: 'none', write: false, confidence: Confidence.UNVERIFIED, ...init };
}

export const configurable = (
  read: ReadSource,
  write: boolean,
  confidence: Confidence,
  extra: Partial<FeatureSupport> = {},
): FeatureSupport => feature(FeatureStatus.CONFIGURABLE, { read, write, confidence, ...extra });

export function emptyCapabilities(): Capabilities {
  const caps = {} as Capabilities;
  for (const f of FEATURES) caps[f] = feature(FeatureStatus.UNKNOWN);
  return caps;
}

/** True when the UI should offer controls for the feature. */
export function isAvailable(s: FeatureSupport): boolean {
  return s.write || s.read !== 'none';
}

/** True when the feature exists on the hardware at all (including fixed or non-programmable). */
export function isPresent(s: FeatureSupport): boolean {
  return (
    isAvailable(s) ||
    s.status === FeatureStatus.SUPPORTED_FIXED ||
    s.status === FeatureStatus.PHYSICALLY_PRESENT_NOT_PROGRAMMABLE
  );
}

export const STATUS_LABEL: Record<FeatureStatus, string> = {
  CONFIGURABLE: 'Configurable',
  SUPPORTED_READ_ONLY: 'Read-only',
  SUPPORTED_FIXED: 'Fixed',
  PHYSICALLY_PRESENT_NOT_PROGRAMMABLE: 'Hardware only',
  NOT_YET_REVERSE_ENGINEERED: 'Not yet reverse-engineered',
  NOT_SUPPORTED: 'Not supported',
  UNKNOWN: 'Unknown',
};

/** Text symbol per status; never the only signal (labels accompany it). */
export const STATUS_SYMBOL: Record<FeatureStatus, string> = {
  CONFIGURABLE: '✓',
  SUPPORTED_READ_ONLY: '◉',
  SUPPORTED_FIXED: '⚙',
  PHYSICALLY_PRESENT_NOT_PROGRAMMABLE: '◆',
  NOT_YET_REVERSE_ENGINEERED: '◌',
  NOT_SUPPORTED: '—',
  UNKNOWN: '?',
};

/** Compact boolean view (configurable at all). */
export function capabilitySummary(caps: Capabilities): Record<FeatureId, boolean> {
  const out = {} as Record<FeatureId, boolean>;
  for (const f of FEATURES) out[f] = isAvailable(caps[f]);
  return out;
}

export function capabilityStatusMap(caps: Capabilities): Record<FeatureId, FeatureStatus> {
  const out = {} as Record<FeatureId, FeatureStatus>;
  for (const f of FEATURES) out[f] = caps[f].status;
  return out;
}

/** Restrict capabilities, e.g. when the active transport (Bluetooth) blocks configuration. */
export function restrictCapabilities(
  caps: Capabilities,
  allowed: (feature: FeatureId, support: FeatureSupport) => FeatureSupport,
): Capabilities {
  const out = {} as Capabilities;
  for (const f of FEATURES) out[f] = allowed(f, caps[f]);
  return out;
}

import { Evidence } from '../evidence.js';
import type { SafetyLevel } from '../safety.js';

/**
 * Capability identifiers. Generic ids come first; device-specific ones (tftClock, winLock …) exist
 * because the flagship exposes them as separate controls.
 */
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
  'profiles',
  'encoder',
  'battery',
  'pollingRate',
  'gameMode',
  'winLock',
  'altLocks',
  'sleep',
  'keyResponse',
  'debounce',
  'actuation',
  'rapidTrigger',
  'socd',
  'dks',
  'calibration',
  'analog',
  'firmware',
  'factoryDefaults',
] as const;

export type FeatureId = (typeof FEATURES)[number];

/**
 * What OpenKey knows about a feature. "Not implemented yet" is never reported as "not supported";
 * a screen whose upload protocol is unknown is PHYSICALLY_PRESENT or NOT_YET_REVERSE_ENGINEERED,
 * never NOT_SUPPORTED.
 */
export const FeatureStatus = {
  /** Read and write implemented and verified on hardware. */
  SUPPORTED: 'SUPPORTED',
  /** Read and/or write implemented; verification state is in `confidence`. */
  CONFIGURABLE: 'CONFIGURABLE',
  /** The value can be read, not changed. */
  READ_ONLY: 'READ_ONLY',
  /** The value can be written, never read back from the device. */
  WRITE_ONLY: 'WRITE_ONLY',
  /** Exists with a fixed value (e.g. a declared USB interval that has no setting). */
  FIXED: 'FIXED',
  /** Hardware exists and works through standard HID; no configuration protocol. */
  PHYSICALLY_PRESENT: 'PHYSICALLY_PRESENT',
  /** The hardware likely supports it; the protocol is unknown. */
  NOT_YET_REVERSE_ENGINEERED: 'NOT_YET_REVERSE_ENGINEERED',
  /** Evidence shows the device does not offer it. */
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  /** Not available over the current link (e.g. Bluetooth has no settings channel). */
  TRANSPORT_LIMITED: 'TRANSPORT_LIMITED',
  /** Not available on this firmware revision. */
  FIRMWARE_LIMITED: 'FIRMWARE_LIMITED',
  /** Implemented from a source but never exercised on hardware. */
  UNVERIFIED: 'UNVERIFIED',
  /** No evidence either way. */
  UNKNOWN: 'UNKNOWN',
} as const;
export type FeatureStatus = (typeof FeatureStatus)[keyof typeof FeatureStatus];

/**
 * Where reads come from:
 * - `device`: the firmware returns the value.
 * - `mirror`: the firmware is write-only for this feature; OpenKey shows what it last wrote.
 * - `none`: not readable at all.
 */
export type ReadSource = 'device' | 'mirror' | 'none';

export interface FeatureSupport {
  status: FeatureStatus;
  read: ReadSource;
  write: boolean;
  /** Evidence for the implementation (the weakest of read and write when both exist). */
  confidence: Evidence;
  /** Risk class of the write operation; READ_ONLY when nothing is written. */
  safety?: SafetyLevel;
  /** Short human value for fixed/read-only features, e.g. "Volume ±, Mute". */
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
  return { status, read: 'none', write: false, confidence: Evidence.UNKNOWN, ...init };
}

export const configurable = (
  read: ReadSource,
  write: boolean,
  confidence: Evidence,
  extra: Partial<FeatureSupport> = {},
): FeatureSupport => {
  // A write that cannot be read back from the device is reported as WRITE_ONLY, so the UI never
  // implies that the shown value came from the keyboard.
  const status =
    write && read !== 'device'
      ? FeatureStatus.WRITE_ONLY
      : write && confidence === Evidence.VERIFIED
        ? FeatureStatus.SUPPORTED
        : FeatureStatus.CONFIGURABLE;
  return feature(status, { read, write, confidence, ...extra });
};

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
    s.status === FeatureStatus.FIXED ||
    s.status === FeatureStatus.PHYSICALLY_PRESENT ||
    s.status === FeatureStatus.NOT_YET_REVERSE_ENGINEERED
  );
}

/**
 * How navigation treats a feature: `show` (controls), `research` (shown with "protocol research
 * needed"), `hide` (irrelevant to this device).
 */
export function navigationMode(s: FeatureSupport): 'show' | 'research' | 'hide' {
  if (isAvailable(s)) return 'show';
  if (
    s.status === FeatureStatus.NOT_YET_REVERSE_ENGINEERED ||
    s.status === FeatureStatus.PHYSICALLY_PRESENT ||
    s.status === FeatureStatus.TRANSPORT_LIMITED
  )
    return 'research';
  return 'hide';
}

export const STATUS_LABEL: Record<FeatureStatus, string> = {
  SUPPORTED: 'Supported',
  CONFIGURABLE: 'Configurable',
  READ_ONLY: 'Read-only',
  WRITE_ONLY: 'Write-only',
  FIXED: 'Fixed',
  PHYSICALLY_PRESENT: 'Hardware only',
  NOT_YET_REVERSE_ENGINEERED: 'Not yet reverse-engineered',
  NOT_SUPPORTED: 'Not supported',
  TRANSPORT_LIMITED: 'Not on this connection',
  FIRMWARE_LIMITED: 'Not on this firmware',
  UNVERIFIED: 'Unverified',
  UNKNOWN: 'Unknown',
};

/** Text symbol per status; never the only signal (labels accompany it). */
export const STATUS_SYMBOL: Record<FeatureStatus, string> = {
  SUPPORTED: '✓',
  CONFIGURABLE: '✓',
  READ_ONLY: '◉',
  WRITE_ONLY: '↦',
  FIXED: '⚙',
  PHYSICALLY_PRESENT: '◆',
  NOT_YET_REVERSE_ENGINEERED: '◌',
  NOT_SUPPORTED: '—',
  TRANSPORT_LIMITED: '⇄',
  FIRMWARE_LIMITED: '⌁',
  UNVERIFIED: '△',
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

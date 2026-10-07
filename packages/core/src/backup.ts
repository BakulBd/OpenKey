import type { Capabilities, FeatureId } from './model/capabilities.js';
import { isAvailable } from './model/capabilities.js';
import type { DeviceInfo, TransportMode } from './model/device.js';
import type { KeymapState } from './model/keymap.js';
import type { PerKeyRgb, RgbConfig } from './model/lighting.js';
import type { Macro } from './model/macros.js';
import type { SystemSettings } from './model/settings.js';

export const BACKUP_FORMAT = 'openak820-backup';
export const BACKUP_VERSION = 1;

export type BackupSection =
  'keymap' | 'fnLayers' | 'rgb' | 'perKeyRgb' | 'macros' | 'settings' | 'tft';

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  createdBy: string;
  device: Pick<DeviceInfo, 'model' | 'profileId' | 'identity'>;
  firmware: { version: string | null };
  protocol: { id: string; name: string };
  transport: TransportMode;
  keymap?: KeymapState;
  fnLayers?: KeymapState;
  rgb?: RgbConfig;
  perKeyRgb?: PerKeyRgb;
  macros?: Macro[];
  settings?: SystemSettings;
  /** TFT content cannot be read back from firmware; only metadata of the last upload is kept. */
  tft?: { lastUpload?: { frames: number; at: string } };
  /** For each section: whether the data came from the device or from OpenAK820's mirror. */
  provenance: Partial<Record<BackupSection, 'device' | 'mirror'>>;
  /** Fields this version does not understand are carried forward untouched. */
  unknown: Record<string, unknown>;
}

const KNOWN_KEYS = new Set([
  'format',
  'version',
  'createdAt',
  'createdBy',
  'device',
  'firmware',
  'protocol',
  'transport',
  'keymap',
  'fnLayers',
  'rgb',
  'perKeyRgb',
  'macros',
  'settings',
  'tft',
  'provenance',
  'unknown',
]);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  backup?: Backup;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateBackup(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(input)) return { ok: false, errors: ['Backup is not a JSON object'], warnings };
  if (input.format !== BACKUP_FORMAT) errors.push(`Unknown format "${String(input.format)}"`);
  if (input.version !== BACKUP_VERSION)
    errors.push(`Unsupported backup version ${String(input.version)}`);
  if (!isObject(input.device) || !isObject(input.device.identity))
    errors.push('Missing device identity');
  if (!isObject(input.protocol) || typeof input.protocol.id !== 'string')
    errors.push('Missing protocol id');

  for (const section of ['keymap', 'fnLayers'] as const) {
    const s = input[section];
    if (s !== undefined && (!isObject(s) || !isObject(s.slots)))
      errors.push(`${section} is malformed`);
  }
  if (input.macros !== undefined && !Array.isArray(input.macros))
    errors.push('macros must be an array');
  if (input.rgb !== undefined) {
    const rgb = input.rgb;
    if (!isObject(rgb) || typeof rgb.effect !== 'number' || !isObject(rgb.color))
      errors.push('rgb is malformed');
  }

  const unknown: Record<string, unknown> = isObject(input.unknown) ? { ...input.unknown } : {};
  for (const k of Object.keys(input)) {
    if (!KNOWN_KEYS.has(k)) {
      unknown[k] = input[k];
      warnings.push(`Unknown top-level field "${k}" preserved`);
    }
  }
  if (errors.length) return { ok: false, errors, warnings };
  const backup = {
    ...(input as unknown as Backup),
    unknown,
    provenance: (input.provenance as Backup['provenance']) ?? {},
  };
  return { ok: true, errors, warnings, backup };
}

const SECTION_FEATURE: Record<BackupSection, FeatureId> = {
  keymap: 'keymap',
  fnLayers: 'fnLayer',
  rgb: 'rgb',
  perKeyRgb: 'perKeyRgb',
  macros: 'macros',
  settings: 'sleep',
  tft: 'tft',
};

export interface RestorePlan {
  compatible: boolean;
  blocked: string[];
  warnings: string[];
  sections: BackupSection[];
}

/** Decides which sections of a backup can be written to the connected keyboard. */
export function planRestore(backup: Backup, device: DeviceInfo, caps: Capabilities): RestorePlan {
  const blocked: string[] = [];
  const warnings: string[] = [];
  if (backup.protocol.id !== device.protocol.id) {
    blocked.push(
      `Backup was taken with protocol "${backup.protocol.id}" but the keyboard uses "${device.protocol.id}".`,
    );
  }
  if (backup.device.profileId !== device.profileId) {
    warnings.push(
      `Backup model "${backup.device.model}" differs from connected "${device.model}"; key positions may not match.`,
    );
  }
  if (
    backup.firmware.version &&
    device.firmware.version &&
    backup.firmware.version !== device.firmware.version
  ) {
    warnings.push(
      `Firmware differs (backup ${backup.firmware.version}, keyboard ${device.firmware.version}).`,
    );
  }
  const sections: BackupSection[] = [];
  for (const s of ['keymap', 'fnLayers', 'rgb', 'perKeyRgb', 'macros', 'settings'] as const) {
    if (backup[s] === undefined) continue;
    const feature = SECTION_FEATURE[s];
    const support = caps[feature];
    if (!isAvailable(support) || !support.write) {
      warnings.push(`Section "${s}" skipped: the keyboard does not support writing ${feature}.`);
      continue;
    }
    sections.push(s);
  }
  if (backup.tft)
    warnings.push('TFT images cannot be restored from a backup (the firmware cannot export them).');
  return { compatible: blocked.length === 0, blocked, warnings, sections };
}

export interface BackupChange {
  section: string;
  path: string;
  before: unknown;
  after: unknown;
}

/** Shallow-structural diff used for the "Preview changes" step. */
export function diffBackups(current: Partial<Backup>, incoming: Partial<Backup>): BackupChange[] {
  const changes: BackupChange[] = [];
  const walk = (section: string, path: string, a: unknown, b: unknown): void => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (isObject(a) && isObject(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
        walk(section, `${path}.${k}`, a[k], b[k]);
      return;
    }
    changes.push({ section, path, before: a, after: b });
  };
  for (const s of ['keymap', 'fnLayers', 'rgb', 'perKeyRgb', 'macros', 'settings'] as const) {
    walk(s, s, current[s], incoming[s]);
  }
  return changes;
}

import type { Capabilities, FeatureId } from './model/capabilities.js';
import { isAvailable } from './model/capabilities.js';
import type { DeviceInfo, TransportMode } from './model/device.js';
import type { KeymapState } from './model/keymap.js';
import type { PerKeyRgb, RgbConfig } from './model/lighting.js';
import type { Macro } from './model/macros.js';
import type { SystemSettings } from './model/settings.js';

export const BACKUP_FORMAT = 'openkey-backup';
export const BACKUP_VERSION = 2;
/** Backups written by OpenAK820 (before the rename); read and migrated, never written. */
export const LEGACY_BACKUP_FORMAT = 'openak820-backup';
export const LEGACY_BACKUP_VERSION = 1;

export type BackupSection =
  'keymap' | 'fnLayers' | 'rgb' | 'perKeyRgb' | 'macros' | 'settings' | 'tft';

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  createdBy: string;
  /** OpenKey version that wrote the backup ("unknown" for migrated v1 backups). */
  appVersion: string;
  device: Pick<DeviceInfo, 'model' | 'profileId' | 'identity'> & {
    /** Canonical HID descriptor signature, when the writer knew it. */
    descriptorSignature?: string;
  };
  firmware: { version: string | null };
  protocol: { id: string; name: string };
  adapter: { id: string; version: string; family: string };
  transport: TransportMode;
  keymap?: KeymapState;
  fnLayers?: KeymapState;
  rgb?: RgbConfig;
  perKeyRgb?: PerKeyRgb;
  macros?: Macro[];
  settings?: SystemSettings;
  /** TFT content cannot be read back from firmware; only metadata of the last upload is kept. */
  tft?: { lastUpload?: { frames: number; at: string } };
  /** For each section: whether the data came from the device or from OpenKey's mirror. */
  provenance: Partial<Record<BackupSection, 'device' | 'mirror'>>;
  /** Fields this version does not understand are carried forward untouched. */
  unknown: Record<string, unknown>;
}

const KNOWN_KEYS = new Set([
  'format',
  'version',
  'createdAt',
  'createdBy',
  'appVersion',
  'adapter',
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

/** v1 (OpenAK820) → v2: adds appVersion and adapter; data sections are unchanged. */
function migrateV1(v1: Record<string, unknown>): Record<string, unknown> {
  const protocol = isObject(v1.protocol) ? v1.protocol : {};
  const id = typeof protocol.id === 'string' ? protocol.id : 'unknown';
  return {
    ...v1,
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: 'unknown',
    adapter: { id, version: 'unknown', family: id },
  };
}

export function validateBackup(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['Backup is not a JSON object'], warnings };
  let input: Record<string, unknown> = raw;
  if (input.format === LEGACY_BACKUP_FORMAT && input.version === LEGACY_BACKUP_VERSION) {
    input = migrateV1(input);
    warnings.push('Migrated from an OpenAK820 backup (format v1).');
  } else {
    if (input.format !== BACKUP_FORMAT) errors.push(`Unknown format "${String(input.format)}"`);
    else if (typeof input.version === 'number' && input.version > BACKUP_VERSION)
      errors.push(`Backup version ${input.version} is newer than this OpenKey supports (${BACKUP_VERSION}); update OpenKey.`);
    else if (input.version !== BACKUP_VERSION)
      errors.push(`Unsupported backup version ${String(input.version)}`);
  }
  if (!isObject(input.adapter) || typeof input.adapter.id !== 'string') errors.push('Missing adapter');
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
/** Sections indexed by firmware key slot or LED index: meaningless on a different model. */
const SLOT_SECTIONS: readonly BackupSection[] = ['keymap', 'fnLayers', 'perKeyRgb'];

export function planRestore(
  backup: Backup,
  device: DeviceInfo,
  caps: Capabilities,
  opts: {
    /** Restore slot-indexed sections onto a different model anyway (explicit user choice only). */
    allowOtherModel?: boolean;
  } = {},
): RestorePlan {
  const blocked: string[] = [];
  const warnings: string[] = [];
  const otherModel = backup.device.profileId !== device.profileId;
  if (backup.protocol.id !== device.protocol.id) {
    blocked.push(
      `Backup was taken with protocol "${backup.protocol.id}" but the keyboard uses "${device.protocol.id}".`,
    );
  }
  if (otherModel) {
    warnings.push(
      opts.allowOtherModel
        ? `Backup model "${backup.device.model}" differs from connected "${device.model}"; key positions may not match.`
        : `Backup model "${backup.device.model}" differs from connected "${device.model}": keymaps and per-key colours are skipped because key positions differ between models.`,
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
    if (otherModel && !opts.allowOtherModel && SLOT_SECTIONS.includes(s)) continue;
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

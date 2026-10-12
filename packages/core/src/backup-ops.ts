import { BACKUP_FORMAT, BACKUP_VERSION, planRestore } from './backup.js';
import type { Backup, BackupSection, RestorePlan } from './backup.js';
import type { KeyboardDriver } from './driver.js';
import { isOpenKeyError } from './errors.js';
import type { Capabilities, FeatureId } from './model/capabilities.js';
import { runTransaction } from './transaction.js';
import type { Transaction, TxResult } from './transaction.js';

export interface BackupWriter {
  createdBy?: string;
  appVersion?: string;
  adapter?: { id: string; version: string; family: string };
  descriptorSignature?: string;
}

async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    if (isOpenKeyError(e) && e.code === 'UNSUPPORTED_FEATURE') return undefined;
    throw e;
  }
}

/** Collects everything the driver can report (device reads and mirrors) into a backup document. */
export async function collectBackup(
  driver: KeyboardDriver,
  writer: string | BackupWriter = 'OpenKey',
): Promise<Backup> {
  const w: BackupWriter = typeof writer === 'string' ? { createdBy: writer } : writer;
  const info = await driver.getDeviceInfo();
  const caps = driver.getCapabilities();
  const provenance: Backup['provenance'] = {};
  const backup: Backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    createdBy: w.createdBy ?? 'OpenKey',
    appVersion: w.appVersion ?? 'unknown',
    device: {
      model: info.model,
      profileId: info.profileId,
      identity: info.identity,
      ...(w.descriptorSignature ? { descriptorSignature: w.descriptorSignature } : {}),
    },
    firmware: { version: info.firmware.version },
    protocol: { id: info.protocol.id, name: info.protocol.name },
    adapter: w.adapter ?? { id: info.protocol.id, version: 'unknown', family: driver.protocolId },
    transport: info.transport,
    provenance,
    unknown: {},
  };
  const take = async <K extends BackupSection>(
    section: K,
    readable: boolean,
    source: 'device' | 'mirror' | 'none',
    fn: () => Promise<Backup[K]>,
  ) => {
    if (!readable) return;
    const v = await attempt(fn);
    if (v !== undefined) {
      (backup as unknown as Record<string, unknown>)[section] = v;
      if (source !== 'none') provenance[section] = source;
    }
  };
  await take('keymap', caps.keymap.read !== 'none', caps.keymap.read, () =>
    driver.getKeymap('base'),
  );
  await take('fnLayers', caps.fnLayer.read !== 'none', caps.fnLayer.read, () =>
    driver.getKeymap('fn'),
  );
  await take('rgb', caps.rgb.read !== 'none', caps.rgb.read, () => driver.getRgbConfig());
  await take('perKeyRgb', caps.perKeyRgb.read !== 'none', caps.perKeyRgb.read, () =>
    driver.getPerKeyRgb(),
  );
  await take('macros', caps.macros.read !== 'none', caps.macros.read, () => driver.getMacros());
  await take('settings', caps.sleep.read !== 'none', caps.sleep.read, () =>
    driver.getSystemSettings(),
  );
  if (caps.tft.write) {
    const st = await attempt(() => driver.getTftStatus());
    backup.tft = st?.lastUpload ? { lastUpload: st.lastUpload } : {};
  }
  return backup;
}

const SECTION_FEATURE: Record<Exclude<BackupSection, 'tft'>, FeatureId> = {
  keymap: 'keymap',
  fnLayers: 'fnLayer',
  rgb: 'rgb',
  perKeyRgb: 'perKeyRgb',
  macros: 'macros',
  settings: 'sleep',
};

/** One transaction per backup section; read-back only where the device itself reports the value. */
function sectionTransaction(
  driver: KeyboardDriver,
  caps: Capabilities,
  section: Exclude<BackupSection, 'tft'>,
): Transaction<unknown> {
  const fromDevice = caps[SECTION_FEATURE[section]].read === 'device';
  const io: Record<
    Exclude<BackupSection, 'tft'>,
    { write(v: unknown): Promise<void>; read(): Promise<unknown> }
  > = {
    keymap: {
      write: (v) => driver.setKeymap({ ...(v as NonNullable<Backup['keymap']>), layer: 'base' }),
      read: () => driver.getKeymap('base'),
    },
    fnLayers: {
      write: (v) => driver.setKeymap({ ...(v as NonNullable<Backup['fnLayers']>), layer: 'fn' }),
      read: () => driver.getKeymap('fn'),
    },
    rgb: {
      write: (v) => driver.setRgbConfig(v as NonNullable<Backup['rgb']>),
      read: () => driver.getRgbConfig(),
    },
    perKeyRgb: {
      write: (v) => driver.setPerKeyRgb(v as NonNullable<Backup['perKeyRgb']>),
      read: () => driver.getPerKeyRgb(),
    },
    macros: {
      write: (v) => driver.setMacros(v as NonNullable<Backup['macros']>),
      read: () => driver.getMacros(),
    },
    settings: {
      write: (v) => driver.setSystemSettings(v as NonNullable<Backup['settings']>),
      read: () => driver.getSystemSettings(),
    },
  };
  return {
    label: `Restore ${section}`,
    // Drivers throw when a protocol acknowledgement is missing, so resolving means acknowledged.
    acknowledged: true,
    apply: io[section].write,
    ...(fromDevice ? { readbackFromDevice: io[section].read } : {}),
  };
}

/**
 * Restores the planned sections, each as a transaction: write, then read back from the device
 * where the firmware can report the value. Mirror-backed sections are reported SENT_UNVERIFIED.
 * Stops at the first failure so a broken link does not continue writing.
 */
export async function restoreBackup(
  driver: KeyboardDriver,
  backup: Backup,
  plan?: RestorePlan,
  current?: Partial<Backup>,
): Promise<{ section: BackupSection; result: TxResult<unknown> }[]> {
  const caps = driver.getCapabilities();
  const p = plan ?? planRestore(backup, await driver.getDeviceInfo(), caps);
  if (!p.compatible) throw new Error(`Backup is not compatible: ${p.blocked.join(' ')}`);
  const results: { section: BackupSection; result: TxResult<unknown> }[] = [];
  for (const s of p.sections) {
    if (s === 'tft' || backup[s] === undefined) continue;
    const result = await runTransaction(
      sectionTransaction(driver, caps, s),
      current?.[s],
      backup[s],
    );
    results.push({ section: s, result });
    if (result.outcome === 'FAILED') break;
  }
  return results;
}

/** Applies the planned sections of a backup. Returns the sections actually written. */
export async function applyBackup(
  driver: KeyboardDriver,
  backup: Backup,
  plan?: RestorePlan,
): Promise<BackupSection[]> {
  const results = await restoreBackup(driver, backup, plan);
  const failed = results.find((r) => r.result.outcome === 'FAILED');
  if (failed) throw new Error(failed.result.message);
  return results.filter((r) => r.result.outcome !== 'REJECTED').map((r) => r.section);
}

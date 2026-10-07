import { BACKUP_FORMAT, BACKUP_VERSION, planRestore } from './backup.js';
import type { Backup, BackupSection, RestorePlan } from './backup.js';
import type { KeyboardDriver } from './driver.js';
import { isOpenKeyError } from './errors.js';

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
  createdBy = 'OpenKey',
): Promise<Backup> {
  const info = await driver.getDeviceInfo();
  const caps = driver.getCapabilities();
  const provenance: Backup['provenance'] = {};
  const backup: Backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    createdBy,
    device: { model: info.model, profileId: info.profileId, identity: info.identity },
    firmware: { version: info.firmware.version },
    protocol: { id: info.protocol.id, name: info.protocol.name },
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

/** Applies the planned sections of a backup. Returns the sections actually written. */
export async function applyBackup(
  driver: KeyboardDriver,
  backup: Backup,
  plan?: RestorePlan,
): Promise<BackupSection[]> {
  const p = plan ?? planRestore(backup, await driver.getDeviceInfo(), driver.getCapabilities());
  if (!p.compatible) throw new Error(`Backup is not compatible: ${p.blocked.join(' ')}`);
  const done: BackupSection[] = [];
  for (const s of p.sections) {
    switch (s) {
      case 'keymap':
        if (backup.keymap) await driver.setKeymap({ ...backup.keymap, layer: 'base' });
        break;
      case 'fnLayers':
        if (backup.fnLayers) await driver.setKeymap({ ...backup.fnLayers, layer: 'fn' });
        break;
      case 'rgb':
        if (backup.rgb) await driver.setRgbConfig(backup.rgb);
        break;
      case 'perKeyRgb':
        if (backup.perKeyRgb) await driver.setPerKeyRgb(backup.perKeyRgb);
        break;
      case 'macros':
        if (backup.macros) await driver.setMacros(backup.macros);
        break;
      case 'settings':
        if (backup.settings) await driver.setSystemSettings(backup.settings);
        break;
      case 'tft':
        continue;
    }
    done.push(s);
  }
  return done;
}

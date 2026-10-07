import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  MemoryStateStore,
  collectBackup,
  planRestore,
  restoreBackup,
  validateBackup,
} from '@openkey/core';
import { connectKeyboard, createDefaultRegistry, sonixFeature } from '@openkey/protocols';
import { noSleep } from '../helpers.js';

async function setup() {
  const sim = new sonixFeature.SonixFeatureSimulator();
  const kb = await connectKeyboard(sim.device.group(), {
    registry: createDefaultRegistry(),
    level: 'handshake',
    store: new MemoryStateStore(),
    cmdDelayMs: 0,
    sleep: noSleep,
  });
  return { sim, ...kb };
}

describe('backup format', () => {
  it('writes v2 with app version and adapter', async () => {
    const { driver } = await setup();
    const b = await collectBackup(driver, {
      appVersion: '0.2.0',
      adapter: { id: 'sonix-feature', version: '1.0.0', family: 'sonix-feature' },
    });
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.version).toBe(BACKUP_VERSION);
    expect(b.appVersion).toBe('0.2.0');
    expect(validateBackup(JSON.parse(JSON.stringify(b))).ok).toBe(true);
  });

  it('migrates an OpenAK820 v1 backup without touching its data', () => {
    const v1 = {
      format: 'openak820-backup',
      version: 1,
      createdAt: '2026-10-07T00:00:00Z',
      createdBy: 'openak820-cli',
      device: { model: 'AJAZZ AK820 MAX / MAX PLUS', profileId: 'ak820-max-plus', identity: { vendorId: 3141, productId: 32777, productName: 'AK820 MAX' } },
      firmware: { version: '1.07' },
      protocol: { id: 'sonix-feature', name: 'x' },
      transport: 'usb',
      rgb: { effect: 1, color: { r: 1, g: 2, b: 3 }, brightness: 3, speed: 3 },
      provenance: { rgb: 'mirror' },
      unknown: {},
    };
    const r = validateBackup(v1);
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/OpenAK820/);
    expect(r.backup?.adapter.id).toBe('sonix-feature');
    expect(r.backup?.rgb).toEqual(v1.rgb);
  });

  it('rejects a backup from a newer OpenKey', () => {
    const r = validateBackup({ format: BACKUP_FORMAT, version: 99 });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/newer/);
  });

  it('preserves unknown fields', () => {
    const r = validateBackup({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      device: { identity: {} },
      protocol: { id: 'x' },
      adapter: { id: 'x' },
      futureField: 1,
    });
    expect(r.backup?.unknown).toEqual({ futureField: 1 });
  });
});

describe('restore with read-back', () => {
  it('verifies device-readable sections and reports mirror sections as unverified', async () => {
    const { driver } = await setup();
    const before = await collectBackup(driver);
    const colors = await driver.getPerKeyRgb();
    const changed = { ...colors, 1: { r: 255, g: 0, b: 0 } };
    const keymap = await driver.getKeymap('base');
    const backup = { ...before, perKeyRgb: changed, keymap };
    const plan = planRestore(backup, await driver.getDeviceInfo(), driver.getCapabilities());
    const results = await restoreBackup(driver, backup, plan);
    const by = Object.fromEntries(results.map((r) => [r.section, r.result.outcome]));
    expect(by.perKeyRgb).toBe('VERIFIED');
    expect(by.keymap).toBe('SENT_UNVERIFIED');
  });
});

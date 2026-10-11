import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../helpers.js';

const SCRIPT = path.join(ROOT, 'udev/install-openkey-udev.sh');
const RULE = readFileSync(path.join(ROOT, 'udev/70-openkey.rules'), 'utf8');
const linux = process.platform === 'linux';

describe('Linux udev installer', () => {
  it('embeds exactly the repository rule (one source of truth)', () => {
    const s = readFileSync(SCRIPT, 'utf8');
    const m = /<<'OPENKEY_RULE_EOF'\n([\s\S]*?)OPENKEY_RULE_EOF\n/.exec(s);
    expect(m?.[1]).toBe(RULE);
  });

  it('grants access only to the listed keyboard identities, never world-writable', () => {
    for (const line of RULE.split('\n').filter((l) => l.startsWith('SUBSYSTEM'))) {
      expect(line).toMatch(/SUBSYSTEM=="hidraw"/);
      expect(line).toMatch(/MODE="0660"/);
      expect(line).toMatch(/ATTRS\{idVendor\}=="[0-9a-f]{4}", ATTRS\{idProduct\}=="[0-9a-f]{4}"|KERNELS=="0005:/);
    }
  });

  it.skipIf(!linux)('installs, is idempotent, and uninstalls (target directory, no reload)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openkey-udev-'));
    const run = (...args: string[]) => execFileSync('sh', [SCRIPT, '--target-dir', dir, '--no-reload', ...args], { encoding: 'utf8' });
    expect(run()).toMatch(/Installed/);
    expect(readFileSync(path.join(dir, '70-openkey.rules'), 'utf8')).toBe(RULE);
    expect(run()).toMatch(/already installed/);
    expect(run('--uninstall')).toMatch(/Removed/);
    expect(existsSync(path.join(dir, '70-openkey.rules'))).toBe(false);
  });

  it('sorts before systemd’s 73-seat-late.rules so uaccess grants the logged-in user access', () => {
    expect(path.basename('udev/70-openkey.rules') < '73-seat-late.rules').toBe(true);
    expect(readFileSync(SCRIPT, 'utf8')).toMatch(/^RULE_NAME=70-openkey\.rules$/m);
  });

  it.skipIf(!linux)('replaces the earlier 99-openkey.rules, and only when OpenKey wrote it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openkey-udev-'));
    const run = (...args: string[]) => execFileSync('sh', [SCRIPT, '--target-dir', dir, '--no-reload', ...args], { encoding: 'utf8' });
    writeFileSync(path.join(dir, '99-openkey.rules'), '# OpenKey – old rule\n');
    expect(run()).toMatch(/Removed the earlier OpenKey rule/);
    expect(existsSync(path.join(dir, '99-openkey.rules'))).toBe(false);
    // Someone else's file with the same name is left alone.
    writeFileSync(path.join(dir, '99-openkey.rules'), '# my own rule\n');
    run();
    expect(readFileSync(path.join(dir, '99-openkey.rules'), 'utf8')).toBe('# my own rule\n');
    run('--uninstall');
    expect(existsSync(path.join(dir, '99-openkey.rules'))).toBe(true);
  });

  it.skipIf(!linux)('adds keyboards that are not in the list with --device, and validates the ID', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openkey-udev-'));
    execFileSync('sh', [SCRIPT, '--target-dir', dir, '--no-reload', '--device', '1A2B:3C4D'], { encoding: 'utf8' });
    const installed = readFileSync(path.join(dir, '70-openkey.rules'), 'utf8');
    expect(installed.startsWith(RULE)).toBe(true);
    expect(installed).toMatch(/ATTRS\{idVendor\}=="1a2b", ATTRS\{idProduct\}=="3c4d", MODE="0660"/);
    const bad = spawnSync('sh', [SCRIPT, '--target-dir', dir, '--device', '1a2b:3c4d"; rm -rf /'], { encoding: 'utf8' });
    expect(bad.status).toBe(2);
  });

  it.skipIf(!linux)('changes nothing in dry-run mode', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openkey-udev-'));
    const out = execFileSync('sh', [SCRIPT, '--target-dir', dir, '--dry-run'], { encoding: 'utf8' });
    expect(out).toMatch(/\[dry run\]/);
    expect(existsSync(path.join(dir, '70-openkey.rules'))).toBe(false);
  });

  it.skipIf(!linux || process.getuid?.() === 0)('refuses to touch /etc without administrator rights', () => {
    const r = spawnSync('sh', [SCRIPT], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/sudo sh/);
  });
});

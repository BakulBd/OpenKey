import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../helpers.js';

const SCRIPT = path.join(ROOT, 'udev/install-openkey-udev.sh');
const RULE = readFileSync(path.join(ROOT, 'udev/99-openkey.rules'), 'utf8');
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
    expect(readFileSync(path.join(dir, '99-openkey.rules'), 'utf8')).toBe(RULE);
    expect(run()).toMatch(/already installed/);
    expect(run('--uninstall')).toMatch(/Removed/);
    expect(existsSync(path.join(dir, '99-openkey.rules'))).toBe(false);
  });

  it.skipIf(!linux)('changes nothing in dry-run mode', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openkey-udev-'));
    const out = execFileSync('sh', [SCRIPT, '--target-dir', dir, '--dry-run'], { encoding: 'utf8' });
    expect(out).toMatch(/\[dry run\]/);
    expect(existsSync(path.join(dir, '99-openkey.rules'))).toBe(false);
  });

  it.skipIf(!linux || process.getuid?.() === 0)('refuses to touch /etc without administrator rights', () => {
    const r = spawnSync('sh', [SCRIPT], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/sudo sh/);
  });
});

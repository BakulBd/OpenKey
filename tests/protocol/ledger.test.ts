import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evidenceRank, fromHex } from '@openkey/core';
import { createDefaultRegistry, sonixFeature } from '@openkey/protocols';
import { ROOT } from '../helpers.js';

const ledger = sonixFeature.SONIX_FEATURE_LEDGER;
const implemented = ledger.filter((e) => e.implemented && e.code.startsWith('04 '));

describe('sonix-feature evidence ledger', () => {
  it('lists every command constant, with the same code, and nothing the code does not have', () => {
    const fromCode = Object.entries(sonixFeature.Cmd).map(
      ([name, v]) => `${name}=04 ${v.toString(16).toUpperCase().padStart(2, '0')}`,
    );
    expect(implemented.map((e) => `${e.name}=${e.code}`).sort()).toEqual(fromCode.sort());
  });

  it('VERIFIED entries name the unit and cite a hardware fixture that says VERIFIED', () => {
    for (const e of ledger.filter((x) => x.evidence === 'VERIFIED')) {
      expect(e.testedOn, e.name).toBeTruthy();
      const fixtures = e.sources.filter((s) => s.startsWith('fixtures/') && s.endsWith('-hw.json'));
      expect(fixtures.length, e.name).toBeGreaterThan(0);
      for (const f of fixtures) {
        expect(existsSync(path.join(ROOT, f)), f).toBe(true);
        expect(JSON.parse(readFileSync(path.join(ROOT, f), 'utf8')).confidence, f).toBe('VERIFIED');
      }
    }
  });

  it('destructive entries are documentation only and have no command constant', () => {
    const destructive = ledger.filter((e) => e.class === 'destructive');
    expect(destructive.length).toBeGreaterThan(0);
    for (const e of destructive) {
      expect(e.implemented, e.name).toBe(false);
      expect(Object.keys(sonixFeature.Cmd), e.name).not.toContain(e.name);
    }
  });

  it('no capability claims more evidence than the commands it depends on', () => {
    const caps = sonixFeature.sonixFeatureCapabilities(
      sonixFeature.resolveVariant('AK820 MAX'),
      'usb',
      0x8009,
    );
    for (const [feature, c] of Object.entries(caps)) {
      if (!c.write) continue;
      const deps = ledger.filter((e) => e.implemented && e.usedBy.includes(feature as never));
      expect(deps.length, `${feature} has no ledger entry`).toBeGreaterThan(0);
      const weakest = Math.min(...deps.map((e) => evidenceRank(e.evidence)));
      expect(evidenceRank(c.confidence), feature).toBeLessThanOrEqual(weakest);
    }
  });

  it('every operation the probe sends is a ledger entry with the same evidence', () => {
    const plan = createDefaultRegistry().get('sonix-feature')!.probePlan;
    for (const op of plan.operations.filter((o) => o.op === 'feature-set')) {
      const prefix = fromHex(op.payloadPrefix);
      const e = implemented.find((x) => fromHex(x.code).every((b, i) => prefix[i] === b));
      expect(e, op.payloadPrefix).toBeDefined();
      expect(e!.evidence).toBe(op.evidence);
      expect(e!.class).not.toBe('write-persistent');
    }
  });
});

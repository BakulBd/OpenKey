import { describe, expect, it } from 'vitest';
import { CATALOG, MODEL_GUIDE } from '@openkey/devices';
import type { DeviceIdentity } from '@openkey/core';
import type { MockHidDevice } from '@openkey/hid';
import { byTech, createDefaultRegistry, royuan, sonixFeature } from '@openkey/protocols';

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
const revisions = MODEL_GUIDE.flatMap((e) =>
  (e.revisions ?? []).map((r) => ({ ...r, model: `${e.brand} ${e.model}` })),
);

describe('model guide', () => {
  // ZMK Studio is reached over USB serial and is not in the HID registry.
  const ids = new Set([
    ...createDefaultRegistry()
      .list()
      .map((p) => p.id),
    'zmk-studio',
  ]);
  it('names only adapters that exist', () => {
    for (const e of MODEL_GUIDE)
      for (const a of e.adapters) expect(ids.has(a), `${e.brand} ${e.model}: ${a}`).toBe(true);
    for (const r of revisions)
      if (r.adapter) expect(ids.has(r.adapter), `${r.model} ${r.name}`).toBe(true);
  });
  it('never calls a model configurable without an adapter', () => {
    for (const e of MODEL_GUIDE.filter((x) => ['verified', 'adapter', 'via'].includes(x.level)))
      expect(e.adapters.length, `${e.brand} ${e.model}`).toBeGreaterThan(0);
    for (const r of revisions.filter((x) =>
      ['verified', 'community', 'read-only'].includes(x.status),
    ))
      expect(r.adapter, `${r.model} ${r.name}`).not.toBeNull();
  });
  it('has no duplicate models', () => {
    const names = MODEL_GUIDE.map((e) => `${e.brand} ${e.model}`);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('model revisions (one name, several chips)', () => {
  it('writes USB identities as VVVV:PPPP', () => {
    for (const r of revisions)
      for (const id of r.ids)
        expect(id, `${r.model} ${r.name}`).toMatch(/^[0-9A-F]{4}:[0-9A-F]{4}$/);
  });

  it('agrees with the catalogue on the family of every catalogued identity', () => {
    for (const r of revisions)
      for (const id of r.ids) {
        const entries = CATALOG.filter((e) => `${hex4(e.vendorId)}:${hex4(e.productId)}` === id);
        if (!entries.length || !r.adapter) continue;
        const families = entries.flatMap((e) => e.family.split(' or '));
        // aula-receiver is the receiver adapter of the BY Tech family.
        expect(
          families.includes(r.adapter) ||
            (r.adapter === 'aula-receiver' && entries.some((e) => e.family === 'aula-receiver')),
          `${r.model} ${r.name} ${id}`,
        ).toBe(true);
      }
  });

  it('claims "verified" only for the owner-verified catalogue identity', () => {
    const verified = new Set(
      CATALOG.filter((e) => e.status === 'verified').map(
        (e) => `${hex4(e.vendorId)}:${hex4(e.productId)}`,
      ),
    );
    for (const r of revisions.filter((x) => x.status === 'verified'))
      for (const id of r.ids) expect(verified.has(id), `${r.model} ${r.name} ${id}`).toBe(true);
  });

  // Each revision of the AK820 MAX Plus is a different chip; the keyboard's own answer decides.
  const sims: Record<string, (id: DeviceIdentity) => MockHidDevice> = {
    'sonix-feature': (identity) => new sonixFeature.SonixFeatureSimulator(identity).device,
    royuan: (identity) => new royuan.RoyuanSimulator('yc500', 3056, identity).device,
    'by-tech': (identity) => new byTech.ByTechSimulator({ identity }).device,
  };

  it('resolves every simulated revision of the AK820 MAX Plus to its own adapter', async () => {
    const plus = MODEL_GUIDE.find((e) => e.model === 'AK820 MAX Plus')!;
    let tested = 0;
    for (const r of plus.revisions!) {
      const make = r.adapter && sims[r.adapter];
      if (!make || !r.ids[0]) continue;
      const [vendorId, productId] = r.ids[0].split(':').map((h) => parseInt(h, 16)) as [
        number,
        number,
      ];
      const group = make({ vendorId, productId, productName: 'AK820 MAX' }).group();
      const report = await createDefaultRegistry().detect(group, {
        level: 'handshake',
        consent: [r.adapter!],
      });
      expect(report.selected?.protocolId, `${r.name} ${r.ids[0]}`).toBe(r.adapter);
      expect(report.selected?.identification).toBe('identified');
      tested++;
    }
    expect(tested).toBeGreaterThanOrEqual(4);
  });
});

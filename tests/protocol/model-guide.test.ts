import { describe, expect, it } from 'vitest';
import { MODEL_GUIDE } from '@openkey/devices';
import { createDefaultRegistry } from '@openkey/protocols';

describe('model guide', () => {
  const ids = new Set(
    createDefaultRegistry()
      .list()
      .map((p) => p.id),
  );
  it('names only adapters that exist', () => {
    for (const e of MODEL_GUIDE)
      for (const a of e.adapters) expect(ids.has(a), `${e.brand} ${e.model}: ${a}`).toBe(true);
  });
  it('never calls a model configurable without an adapter', () => {
    for (const e of MODEL_GUIDE.filter((x) => ['verified', 'adapter', 'via'].includes(x.level)))
      expect(e.adapters.length, `${e.brand} ${e.model}`).toBeGreaterThan(0);
  });
  it('has no duplicate models', () => {
    const names = MODEL_GUIDE.map((e) => `${e.brand} ${e.model}`);
    expect(new Set(names).size).toBe(names.length);
  });
});

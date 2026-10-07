import { describe, expect, it } from 'vitest';
import type { RgbConfig } from '@openak820/core';
import { sonixFeature } from '@openak820/protocols';
import { fixture, hex } from '../helpers.js';

interface LightingFixture {
  example: { config: RgbConfig; sequence: { hex: string }[] };
}

describe('sonix-feature lighting codec', () => {
  const catalog = sonixFeature.effectCatalog(5, 5);
  const fx = fixture<LightingFixture>('rgb/sonix-feature-lighting.json');

  it('encodes the data packet exactly like FUN_0042b100', () => {
    const data = sonixFeature.encodeLightingData(fx.example.config, catalog);
    expect(Array.from(data)).toEqual(Array.from(hex(fx.example.sequence[2]!.hex)));
  });

  it('decodes back to the same configuration', () => {
    const data = sonixFeature.encodeLightingData(fx.example.config, catalog);
    expect(sonixFeature.decodeLightingData(data)).toEqual(fx.example.config);
  });

  it('maps directions from the official radio wiring', () => {
    for (const [dir, code] of Object.entries({ left: 0, right: 1, up: 2, down: 3 })) {
      const d = sonixFeature.encodeLightingData(
        { ...fx.example.config, direction: dir as RgbConfig['direction'] },
        catalog,
      );
      expect(d[11]).toBe(code);
    }
  });

  it('clamps brightness and speed to the catalog range', () => {
    const d = sonixFeature.encodeLightingData(
      { ...fx.example.config, brightness: 99, speed: -3 },
      catalog,
    );
    expect(d[9]).toBe(5);
    expect(d[10]).toBe(0);
  });

  it('lists the 20 effects of the official name table', () => {
    expect(catalog.effects).toHaveLength(20);
    expect(catalog.effects[1]).toMatchObject({ id: 1, name: 'Static' });
    expect(catalog.effects[19]).toMatchObject({ id: 0x13, name: 'Shuttle' });
  });

  it('encodes per-key entries as [led, R, G, B] and reads them back', () => {
    const t = sonixFeature.encodePerKeyTable({
      1: { r: 255, g: 0, b: 0 },
      94: { r: 1, g: 2, b: 3 },
    });
    expect(Array.from(t.subarray(4, 8))).toEqual([1, 255, 0, 0]);
    expect(Array.from(t.subarray(94 * 4, 94 * 4 + 4))).toEqual([94, 1, 2, 3]);
    expect(Array.from(t.subarray(574))).toEqual([0xaa, 0x55]);
    expect(sonixFeature.decodePerKeyTable(t, [1, 94])).toEqual({
      1: { r: 255, g: 0, b: 0 },
      94: { r: 1, g: 2, b: 3 },
    });
    expect(sonixFeature.perKeyTableLooksValid(t, [1, 94, 55]).ok).toBe(true);
  });
});

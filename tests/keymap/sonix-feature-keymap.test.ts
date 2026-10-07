import { describe, expect, it } from 'vitest';
import type { KeyAction } from '@openkey/core';
import { sonixFeature } from '@openkey/protocols';
import { getLayout } from '@openkey/devices';
import { fixture, hex } from '../helpers.js';

interface SlotFixture {
  cases: { action: KeyAction; slot: string }[];
}

const fx = fixture<SlotFixture>('keymap/sonix-feature-slot-encoding.json');

describe('sonix-feature key slot codec', () => {
  for (const c of fx.cases) {
    it(`encodes ${JSON.stringify(c.action)} as ${c.slot}`, () => {
      expect(Array.from(sonixFeature.encodeSlot(c.action))).toEqual(Array.from(hex(c.slot)));
    });
  }

  it('round-trips every fixture case', () => {
    for (const c of fx.cases) {
      const decoded = sonixFeature.decodeSlot(hex(c.slot));
      expect(sonixFeature.encodeSlot(decoded)).toEqual(Array.from(hex(c.slot)));
    }
  });

  it('preserves unknown encodings as raw', () => {
    expect(sonixFeature.decodeSlot([0x07, 0x01, 0x02, 0x03])).toEqual({
      kind: 'raw',
      bytes: [7, 1, 2, 3],
    });
    expect(sonixFeature.encodeSlot({ kind: 'raw', bytes: [7, 1, 2, 3] })).toEqual([7, 1, 2, 3]);
  });

  it('builds a 576-byte table with slots at key_index×4 and an AA 55 trailer', () => {
    const t = sonixFeature.encodeKeymapTable({
      layer: 'base',
      provenance: 'mirror',
      slots: {
        55: { kind: 'keyboard', usage: 0xe0, modifiers: 0 },
        1: { kind: 'consumer', usage: 0xe2 },
      },
    });
    expect(t.length).toBe(576);
    expect(Array.from(t.subarray(55 * 4, 55 * 4 + 4))).toEqual([2, 1, 0, 0]);
    expect(Array.from(t.subarray(4, 8))).toEqual([3, 0xe2, 0, 0]);
    expect(t[574]).toBe(0xaa);
    expect(t[575]).toBe(0x55);
    expect(t.filter((b) => b !== 0).length).toBe(2 + 2 + 2);
  });

  it('rejects slots that would overwrite the trailer', () => {
    expect(() =>
      sonixFeature.encodeKeymapTable({
        layer: 'base',
        provenance: 'mirror',
        slots: { 143: { kind: 'disabled' } },
      }),
    ).toThrow();
  });

  it('uses matrix slots row*18+col from the official key table', () => {
    const l = getLayout('ak820-max');
    const slot = (label: string) => l.keys.find((k) => k.label === label)!.slot;
    expect(slot('Esc')).toBe(1);
    expect(slot('`')).toBe(19);
    expect(slot('Tab')).toBe(37);
    expect(slot('Caps')).toBe(55);
    expect(slot('Space')).toBe(94);
    expect(l.keys.length).toBe(81);
    expect(new Set(l.keys.map((k) => k.slot)).size).toBe(81);
  });
});

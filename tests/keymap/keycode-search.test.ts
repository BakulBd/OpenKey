import { describe, expect, it } from 'vitest';
import { keycodeCatalog, searchKeycodes } from '@openkey/core';

describe('keycode search', () => {
  it('finds a key by QMK name, bare letter, and plain language', () => {
    expect(searchKeycodes('KC_A')[0]?.name).toBe('A');
    expect(searchKeycodes('a')[0]?.name).toBe('A');
    expect(searchKeycodes('letter a')[0]?.name).toBe('A');
  });
  it('finds shortcuts and media keys by intent', () => {
    expect(searchKeycodes('copy').map((e) => e.name)).toEqual(expect.arrayContaining(['Copy', 'Copy (macOS)']));
    expect(searchKeycodes('volume').every((e) => e.group === 'media')).toBe(true);
    expect(searchKeycodes('volume').length).toBeGreaterThan(1);
  });
  it('has unique ids', () => {
    const ids = keycodeCatalog().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

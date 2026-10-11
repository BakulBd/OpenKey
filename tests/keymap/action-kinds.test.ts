import { describe, expect, it } from 'vitest';
import type { KeyAction, KeyActionKind } from '@openkey/core';
import { MemoryStateStore, PacketLog } from '@openkey/core';
import { createDefaultRegistry, sonixAa55, sonixFeature } from '@openkey/protocols';

const SAMPLE: Record<KeyActionKind, KeyAction> = {
  default: { kind: 'default' },
  disabled: { kind: 'disabled' },
  keyboard: { kind: 'keyboard', usage: 0x04, modifiers: 0x01 },
  consumer: { kind: 'consumer', usage: 0xcd },
  system: { kind: 'system', usage: 0x82 },
  mouse: { kind: 'mouse', action: 'left' },
  macro: { kind: 'macro', index: 0, mode: 'once', repeat: 0 },
  layer: { kind: 'layer', layer: 1, mode: 'momentary' },
  special: { kind: 'special', code: 1 },
  raw: { kind: 'raw', bytes: [1, 2, 3, 4] },
};

const drivers = async () => {
  const reg = createDefaultRegistry();
  const opts = { log: new PacketLog(), store: new MemoryStateStore() };
  return [
    { name: 'sonix-feature', d: await reg.get('sonix-feature')!.createDriver(new sonixFeature.SonixFeatureSimulator().device.group(), opts), encode: sonixFeature.encodeSlot },
    { name: 'sonix-aa55', d: await reg.get('sonix-aa55')!.createDriver(new sonixAa55.SonixAa55Simulator().device.group(), opts), encode: sonixAa55.encodeSlotAa55 },
  ];
};

describe('key action kinds offered by the editor', () => {
  it('every advertised kind encodes; every other kind is refused by the codec', async () => {
    for (const { name, d, encode } of await drivers()) {
      const kinds = d.getKeyActionKinds();
      expect(kinds, name).not.toContain('raw');
      for (const k of Object.keys(SAMPLE) as KeyActionKind[]) {
        if (k === 'raw') continue;
        if (kinds.includes(k)) expect(() => encode(SAMPLE[k]), `${name} ${k}`).not.toThrow();
        else expect(() => encode(SAMPLE[k]), `${name} ${k}`).toThrow();
      }
    }
  });

  it('the flagship does not offer system (power/sleep) actions it cannot encode', async () => {
    const [flagship] = await drivers();
    expect(flagship!.d.getKeyActionKinds()).not.toContain('system');
  });
});

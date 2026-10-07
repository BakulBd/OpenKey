import { describe, expect, it } from 'vitest';
import type { Macro } from '@openkey/core';
import { sonixFeature } from '@openkey/protocols';
import { fixture, hex } from '../helpers.js';

describe('sonix-feature framing', () => {
  it('builds command packets 04 <cmd> <sub> … <arg8> <arg9>', () => {
    const p = sonixFeature.commandPacketU16(sonixFeature.Cmd.IMAGE, 1, 0x0109);
    expect(p.length).toBe(64);
    expect(Array.from(p.subarray(0, 10))).toEqual([4, 0x72, 1, 0, 0, 0, 0, 0, 0x09, 0x01]);
  });

  it('recognises the acknowledgement at payload[3]', () => {
    const ack = sonixFeature.parseAck(hex('04 18 00 01'.padEnd(64 * 3 - 1, ' 00')), 0x18);
    expect(ack).toMatchObject({ ok: true, echoes: true, status: 1 });
    expect(sonixFeature.parseAck(new Uint8Array(64), 0x18).ok).toBe(false);
  });
});

describe('sonix-feature macro storage', () => {
  const fx = fixture<{
    example: { macros: Macro[]; imageFirstBytes: Record<string, string>; packets: number };
  }>('macros/sonix-feature-macro-storage.json');

  it('matches the official layout', () => {
    const { image, packets } = sonixFeature.encodeMacroStorage(fx.example.macros);
    expect(packets).toBe(fx.example.packets);
    expect(image.length).toBe(packets * 64);
    for (const [off, bytes] of Object.entries(fx.example.imageFirstBytes)) {
      const want = hex(bytes);
      expect(Array.from(image.subarray(Number(off), Number(off) + want.length))).toEqual(
        Array.from(want),
      );
    }
    expect(Array.from(image.subarray(image.length - 2))).toEqual([0xaa, 0x55]);
  });

  it('marks empty listed slots FFFFFFFF and leaves unlisted slots zero', () => {
    const { image } = sonixFeature.encodeMacroStorage([
      {
        index: 2,
        events: [
          { type: 'key', usage: 5, down: true },
          { type: 'key', usage: 5, down: false },
        ],
      },
    ]);
    const v = new DataView(image.buffer);
    expect(v.getUint32(0, true)).toBe(0xffffffff);
    expect(v.getUint32(4, true)).toBe(0xffffffff);
    expect(v.getUint32(8, true)).toBe(400);
    expect(v.getUint32(12, true)).toBe(0);
  });

  it('round-trips through the decoder', () => {
    const macros: Macro[] = [
      {
        index: 0,
        events: [
          { type: 'key', usage: 0xe0, down: true },
          { type: 'delay', ms: 30 },
          { type: 'key', usage: 6, down: true },
          { type: 'delay', ms: 10 },
          { type: 'key', usage: 6, down: false },
          { type: 'delay', ms: 10 },
          { type: 'key', usage: 0xe0, down: false },
          { type: 'delay', ms: 10 },
        ],
      },
      {
        index: 1,
        events: [
          { type: 'mouse', button: 'right', down: true },
          { type: 'delay', ms: 500 },
          { type: 'mouse', button: 'right', down: false },
          { type: 'delay', ms: 10 },
        ],
      },
    ];
    const { image } = sonixFeature.encodeMacroStorage(macros);
    expect(sonixFeature.decodeMacroStorage(image)).toEqual(macros);
  });

  it('enforces the event budget', () => {
    const events = Array.from({ length: 400 }, (_, i) => ({
      type: 'key' as const,
      usage: 4,
      down: i % 2 === 0,
    }));
    expect(() => sonixFeature.encodeMacroStorage([{ index: 0, events }])).toThrow(
      /event space|storage/,
    );
  });
});

describe('sonix-feature clock and settings', () => {
  it('encodes the clock packet with the weekday at byte 10', () => {
    const fx = fixture<{ example: { data: string } }>('device-info/sonix-feature-time.json');
    const p = sonixFeature.encodeTimeData(new Date(2026, 4, 16, 14, 30, 45), 1);
    expect(Array.from(p)).toEqual(Array.from(hex(fx.example.data)));
  });

  it('encodes the settings packet', () => {
    const p = sonixFeature.encodeSettingsData({
      sleepTime: 2,
      keyResponseTime: 3,
      disableWinKey: true,
      fnSwitch: 0,
    });
    expect(Array.from(p.subarray(0, 9))).toEqual([0, 1, 0, 0, 1, 0, 2, 0, 3]);
    expect(Array.from(p.subarray(62))).toEqual([0xaa, 0x55]);
    expect(sonixFeature.decodeSettingsData(p)).toMatchObject({
      sleepTime: 2,
      keyResponseTime: 3,
      disableWinKey: true,
      disableAltTab: false,
    });
  });
});

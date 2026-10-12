import type { KeyAction } from '@openkey/core';

/**
 * ROYUAN key slots: 128 slots × 4 bytes per layer (sharkfin docs/PROTOCOL.md "Keymap", "Slot values").
 *
 *   00 00 uu 00   HID keyboard usage uu
 *   03 00 lo hi   HID consumer usage
 *   00 00 00 00   base layer: key disabled; Fn layer: falls through to the base layer
 *
 * Everything else (mouse, macros, Fn, combos, specials) is kept as the exact four bytes, so a key read
 * from the keyboard is never rewritten by accident. Which physical key a slot is depends on the board;
 * OpenKey labels slots by what their base layer produces.
 */
export const SLOTS = 128;
export const SLOT_BYTES = 4;
/** Slots 126 and 127 are never written (not transmitted by the vendor's bulk upload). */
export const WRITABLE_SLOTS = 126;

export function decodeSlot(b: Uint8Array | readonly number[], fnLayer: boolean): KeyAction {
  const [t, b1, b2, b3] = [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0];
  if (t === 0 && b1 === 0 && b2 === 0 && b3 === 0)
    return fnLayer ? { kind: 'default' } : { kind: 'disabled' };
  if (t === 0x00 && b1 === 0 && b3 === 0) return { kind: 'keyboard', usage: b2, modifiers: 0 };
  if (t === 0x03 && b1 === 0) return { kind: 'consumer', usage: b2 | (b3 << 8) };
  return { kind: 'raw', bytes: [t, b1, b2, b3] };
}

export class UnencodableSlotError extends Error {}

export function encodeSlot(a: KeyAction, fnLayer: boolean): [number, number, number, number] {
  switch (a.kind) {
    case 'keyboard':
      if (a.modifiers)
        throw new UnencodableSlotError('Key combinations are not written on ROYUAN boards yet.');
      return [0x00, 0x00, a.usage & 0xff, 0x00];
    case 'consumer':
      return [0x03, 0x00, a.usage & 0xff, (a.usage >> 8) & 0xff];
    case 'disabled':
      if (fnLayer)
        throw new UnencodableSlotError(
          'On the Fn layer an empty slot falls through; it cannot disable a key.',
        );
      return [0, 0, 0, 0];
    case 'default':
      if (!fnLayer)
        throw new UnencodableSlotError('The base layer has no default other than its own value.');
      return [0, 0, 0, 0];
    case 'raw':
      return [a.bytes[0] ?? 0, a.bytes[1] ?? 0, a.bytes[2] ?? 0, a.bytes[3] ?? 0];
    default:
      throw new UnencodableSlotError(`${a.kind} is not written on ROYUAN boards yet.`);
  }
}

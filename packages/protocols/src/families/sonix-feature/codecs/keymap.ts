import { ProtocolError } from '@openkey/core';
import type { KeyAction, KeymapState } from '@openkey/core';
import { Page, decodeCommonSlot, encodeCommonSlot } from '../../common/key-slot.js';
import type { Slot } from '../../common/key-slot.js';
import { TABLE_BYTES, TABLE_SLOTS } from '../constants.js';
import { withTrailer } from '../frame.js';

/** Windows-driver sub-codes under page EXTRA_FUNCTION (FUN_00418070). */
export const FUNCTION_DISABLE = 0x03;
export const FUNCTION_PARAM = 0x02;

/** Key slot encoding of the Windows-driver family (FUN_00418070 / FUN_00418420). */
export function encodeSlot(a: KeyAction): Slot {
  const common = encodeCommonSlot(a);
  if (common) return common;
  switch (a.kind) {
    case 'disabled':
      // UI "Disable Key" (language id 202), encoder type 1.
      return [Page.EXTRA_FUNCTION, FUNCTION_DISABLE, 0, 0];
    case 'special':
      // Encoder types 8–11: [05, 02, value].
      return [Page.EXTRA_FUNCTION, FUNCTION_PARAM, a.code & 0xff, 0];
    default:
      throw new ProtocolError(`Key action "${a.kind}" has no encoding in this protocol`);
  }
}

export function decodeSlot(bytes: ArrayLike<number>): KeyAction {
  const common = decodeCommonSlot(bytes);
  if (common) return common;
  const [p = 0, b1 = 0, b2 = 0, b3 = 0] = Array.from(bytes);
  if (p === Page.EXTRA_FUNCTION && b1 === FUNCTION_DISABLE) return { kind: 'disabled' };
  if (p === Page.EXTRA_FUNCTION && b1 === FUNCTION_PARAM) return { kind: 'special', code: b2 };
  return { kind: 'raw', bytes: [p, b1, b2, b3] };
}

/** 576-byte keymap table: zero = default, trailer AA 55 at 574. */
export function encodeKeymapTable(state: KeymapState): Uint8Array {
  const buf = new Uint8Array(TABLE_BYTES);
  for (const [slotStr, action] of Object.entries(state.slots)) {
    const slot = Number(slotStr);
    // Slot 143 overlaps the trailer; the official key table never uses slots above 121.
    if (!Number.isInteger(slot) || slot < 0 || slot >= TABLE_SLOTS - 1)
      throw new ProtocolError(`Keymap slot ${slotStr} is out of range`);
    buf.set(encodeSlot(action), slot * 4);
  }
  return withTrailer(buf);
}

export function decodeKeymapTable(buf: Uint8Array, layer: KeymapState['layer']): KeymapState {
  const slots: Record<number, KeyAction> = {};
  for (let s = 0; s < TABLE_SLOTS - 1; s++) {
    const a = decodeSlot(buf.subarray(s * 4, s * 4 + 4));
    if (a.kind !== 'default') slots[s] = a;
  }
  return { layer, slots, provenance: 'device' };
}

import { ProtocolError, u16le, writeU16le } from '@openkey/core';
import type { Macro, MacroEvent, MacroLimits } from '@openkey/core';
import {
  MACRO_BUFFER_BYTES,
  MACRO_EMPTY_ENTRY,
  MACRO_EVENT_BUDGET_BYTES,
  MACRO_HEADER_BYTES,
  MACRO_INDEX_BYTES,
  MACRO_MIN_DELAY_MS,
  MACRO_SLOTS,
  MacroFlags,
  PACKET_SIZE,
} from '../constants.js';
import { withTrailer } from '../frame.js';

export const MACRO_LIMITS: MacroLimits = {
  slots: MACRO_SLOTS,
  storageBytes: MACRO_BUFFER_BYTES,
  minDelayMs: MACRO_MIN_DELAY_MS,
  maxDelayMs: 0xffff,
};

/** Mouse button → value byte (FUN_0042d6f0: left 1, middle 4, right 2). */
const MOUSE_VALUE = { left: 1, middle: 4, right: 2 } as const;

/**
 * Builds the macro storage image (FUN_0042d6f0):
 *   index: 100 × u32, u16 offset of the macro's block or 0xFFFFFFFF when empty
 *   block: 8-byte header (u16 entry count) then 4-byte entries
 *     key   : [00, 00, usage, B0 down | 30 up]
 *     mouse : [00, 00, button, 90 down | 10 up]
 *     delay : [ms lo, ms hi, 00, 50]   (each key/mouse event is followed by its delay)
 * The image is padded to whole 64-byte packets plus one spare, and ends with AA 55.
 */
export function encodeMacroStorage(macros: Macro[]): { image: Uint8Array; packets: number } {
  const buf = new Uint8Array(MACRO_BUFFER_BYTES);
  const view = new DataView(buf.buffer);

  const bySlot = new Map<number, Macro>();
  for (const m of macros) {
    if (m.index < 0 || m.index >= MACRO_SLOTS)
      throw new ProtocolError(`Macro slot ${m.index} out of range`);
    if (bySlot.has(m.index)) throw new ProtocolError(`Duplicate macro slot ${m.index}`);
    bySlot.set(m.index, m);
  }
  // The official driver walks its macro list (slots 0..N-1): empty list entries become FFFFFFFF,
  // index entries past the end of the list stay zero.
  const listed = bySlot.size ? Math.max(...bySlot.keys()) + 1 : 0;

  let budget = 0;
  let offset = MACRO_INDEX_BYTES;
  for (let slot = 0; slot < listed; slot++) {
    const m = bySlot.get(slot);
    if (!m || m.events.length === 0) {
      view.setUint32(slot * 4, MACRO_EMPTY_ENTRY, true);
      continue;
    }
    const entries = macroEntries(m.events);
    budget += (entries.length / 2) * 8;
    const end = offset + MACRO_HEADER_BYTES + entries.length * 4;
    if (end + 2 > MACRO_BUFFER_BYTES) throw new ProtocolError('Macros exceed on-device storage');
    writeU16le(buf, slot * 4, offset);
    writeU16le(buf, offset, entries.length);
    entries.forEach((e, i) => buf.set(e, offset + MACRO_HEADER_BYTES + i * 4));
    offset = end;
  }
  if (budget > MACRO_EVENT_BUDGET_BYTES) {
    throw new ProtocolError(
      `Macros use ${budget} of ${MACRO_EVENT_BUDGET_BYTES} bytes of event space`,
    );
  }
  // Packet count rule from FUN_0042d6f0: floor(size/64) + (size % 64 ? 2 : 1).
  const packets = Math.floor(offset / PACKET_SIZE) + (offset % PACKET_SIZE ? 2 : 1);
  const image = buf.slice(0, packets * PACKET_SIZE);
  return { image: withTrailer(image), packets };
}

/** Pairs every key/mouse event with a delay entry, as the official recorder does. */
function macroEntries(events: MacroEvent[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'delay') continue;
    if (e.type === 'key')
      out.push(
        Uint8Array.of(0, 0, e.usage & 0xff, e.down ? MacroFlags.KEY_DOWN : MacroFlags.KEY_UP),
      );
    else
      out.push(
        Uint8Array.of(
          0,
          0,
          MOUSE_VALUE[e.button],
          e.down ? MacroFlags.MOUSE_DOWN : MacroFlags.MOUSE_UP,
        ),
      );
    const next = events[i + 1];
    const ms = Math.max(
      MACRO_MIN_DELAY_MS,
      Math.min(0xffff, next?.type === 'delay' ? next.ms : MACRO_MIN_DELAY_MS),
    );
    out.push(Uint8Array.of(ms & 0xff, (ms >> 8) & 0xff, 0, MacroFlags.DELAY));
  }
  return out;
}

/** Inverse of encodeMacroStorage (used by tests and by fixtures). */
export function decodeMacroStorage(image: Uint8Array): Macro[] {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const macros: Macro[] = [];
  for (let slot = 0; slot < MACRO_SLOTS; slot++) {
    const entry = view.getUint32(slot * 4, true);
    if (entry === MACRO_EMPTY_ENTRY || entry === 0) continue;
    const off = u16le(image, slot * 4);
    const count = u16le(image, off);
    const events: MacroEvent[] = [];
    for (let i = 0; i < count; i++) {
      const p = off + MACRO_HEADER_BYTES + i * 4;
      const flags = image[p + 3]!;
      const value = image[p + 2]!;
      if (flags === MacroFlags.DELAY) events.push({ type: 'delay', ms: u16le(image, p) });
      else if (flags === MacroFlags.KEY_DOWN || flags === MacroFlags.KEY_UP)
        events.push({ type: 'key', usage: value, down: flags === MacroFlags.KEY_DOWN });
      else if (flags === MacroFlags.MOUSE_DOWN || flags === MacroFlags.MOUSE_UP) {
        const button = value === 1 ? 'left' : value === 2 ? 'right' : 'middle';
        events.push({ type: 'mouse', button, down: flags === MacroFlags.MOUSE_DOWN });
      }
    }
    macros.push({ index: slot, events });
  }
  return macros;
}

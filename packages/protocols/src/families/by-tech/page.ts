import { ProtocolError } from '@openkey/core';
import { PAGE_MARKER, SETTINGS_PAGE_BYTES } from './constants.js';

/**
 * Byte offsets inside the 128-byte settings page (command 0x84 / 0x04). The page is never built from
 * nothing: it is read from the keyboard, the changed fields are patched, and it is written back, so
 * bytes OpenKey does not understand survive untouched.
 *
 * The AULA layout was confirmed on an AULA F75 by leisiji/AulaSofwareLinux (`config_page.rs`): the
 * live effect at 0x0A (1-based position in the effect list), the sleep timeout at 0x18, and a table
 * of per-effect settings from 0x3A, two bytes per effect: brightness, then speed (high nibble) and
 * colour (low nibble; 7 = colourful).
 */
export interface PageLayout {
  effect: number;
  /** Null when the sleep byte is not known for the model. */
  sleep: number | null;
  effectTable: number;
}

export const AULA_LAYOUT: PageLayout = { effect: 0x0a, sleep: 0x18, effectTable: 0x3a };
export const EFFECT_STRIDE = 2;

/** The fixed colours the firmware stores, in firmware order; 7 asks the firmware to cycle colours. */
export const FIRMWARE_COLORS: readonly [string, number, number, number][] = [
  ['Red', 255, 0, 0],
  ['Green', 0, 255, 0],
  ['Blue', 0, 0, 255],
  ['Yellow', 255, 255, 0],
  ['Magenta', 255, 0, 255],
  ['Cyan', 0, 255, 255],
  ['White', 255, 255, 255],
];
export const COLOR_CYCLE = 7;

export function nearestFirmwareColor(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  FIRMWARE_COLORS.forEach(([, cr, cg, cb], i) => {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** True for a page the keyboard actually sent: full length and its own end marker. */
export function isValidPage(page: Uint8Array): boolean {
  return (
    page.length === SETTINGS_PAGE_BYTES &&
    page[SETTINGS_PAGE_BYTES - 2] === PAGE_MARKER[0] &&
    page[SETTINGS_PAGE_BYTES - 1] === PAGE_MARKER[1]
  );
}

export function assertValidPage(page: Uint8Array): void {
  if (!isValidPage(page))
    throw new ProtocolError(
      'The settings page read from the keyboard has no 5A A5 end marker; nothing is written.',
      {
        length: page.length,
      },
    );
}

/** Byte offset of the settings slot for a 1-based effect position, or null past the marker. */
export function slotOffset(layout: PageLayout, effect: number): number | null {
  if (effect < 1) return null;
  const at = layout.effectTable + (effect - 1) * EFFECT_STRIDE;
  return at + EFFECT_STRIDE <= SETTINGS_PAGE_BYTES - PAGE_MARKER.length ? at : null;
}

export interface SlotSettings {
  brightness: number;
  speed: number;
  /** 0–6 firmware colour, 7 = colourful. */
  color: number;
}

export function readSlot(
  page: Uint8Array,
  layout: PageLayout,
  effect: number,
): SlotSettings | null {
  const at = slotOffset(layout, effect);
  if (at === null) return null;
  const packed = page[at + 1]!;
  return { brightness: page[at]!, speed: packed >> 4, color: packed & 0x0f };
}

/** Returns a patched copy; the input page is never modified. */
export function patchPage(
  page: Uint8Array,
  layout: PageLayout,
  change: { effect?: number; slot?: { effect: number } & Partial<SlotSettings>; sleep?: number },
): Uint8Array {
  assertValidPage(page);
  const out = page.slice();
  if (change.effect !== undefined) out[layout.effect] = change.effect & 0xff;
  if (change.sleep !== undefined) {
    if (layout.sleep === null)
      throw new ProtocolError('the sleep byte is not known for this model');
    out[layout.sleep] = change.sleep & 0xff;
  }
  if (change.slot) {
    const at = slotOffset(layout, change.slot.effect);
    if (at === null) throw new ProtocolError(`effect ${change.slot.effect} has no settings slot`);
    const cur = readSlot(out, layout, change.slot.effect)!;
    const s = {
      ...cur,
      ...Object.fromEntries(Object.entries(change.slot).filter(([, v]) => v !== undefined)),
    };
    out[at] = s.brightness & 0xff;
    out[at + 1] = ((s.speed & 0x0f) << 4) | (s.color & 0x0f);
  }
  return out;
}

/** Offsets whose value differs, for "what changed" views and the read-back check. */
export function diffPages(
  a: Uint8Array,
  b: Uint8Array,
): { offset: number; before: number; after: number }[] {
  const out: { offset: number; before: number; after: number }[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (a[i] !== b[i]) out.push({ offset: i, before: a[i] ?? -1, after: b[i] ?? -1 });
  return out;
}

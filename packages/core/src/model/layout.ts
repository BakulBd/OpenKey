/**
 * Physical keyboard layout. Positions are in key units (1u = one standard keycap) so the UI can
 * render any board without hard-coded geometry. `slot` is the firmware's key index; `light` is
 * the LED index. Both are protocol/model facts and live in profile JSON, never in UI code.
 */
export interface PhysicalKey {
  id: string;
  label: string;
  /** Firmware key-matrix slot used by keymap writes. */
  slot: number;
  /** LED index used by per-key lighting. */
  light: number | null;
  /** Default HID Keyboard usage the key produces. */
  usage: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** True when the vendor disallows remapping this key on the Fn layer. */
  fnLocked?: boolean;
}

export interface KeyboardLayout {
  id: string;
  name: string;
  /** Overall size in key units. */
  width: number;
  height: number;
  keys: PhysicalKey[];
  /** Non-key controls (knob, screen) for rendering only. */
  extras?: { id: string; kind: 'knob' | 'screen'; x: number; y: number; w: number; h: number }[];
  source: string;
}

export function keyBySlot(layout: KeyboardLayout, slot: number): PhysicalKey | undefined {
  return layout.keys.find((k) => k.slot === slot);
}

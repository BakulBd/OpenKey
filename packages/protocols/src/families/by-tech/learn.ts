import { PAGE_MARKER, SETTINGS_PAGE_BYTES } from './constants.js';
import { EFFECT_STRIDE, diffPages, isValidPage } from './page.js';
import type { PageLayout } from './page.js';

/**
 * Learning a settings-page layout from the keyboard's own shortcuts. Nothing is written: the owner
 * presses the keyboard's "next effect" and "brightness up" keys, OpenKey reads the page after each
 * press, and the bytes that moved locate the fields. It runs on observed device behaviour only, so
 * the result is evidence about this keyboard, not a guess.
 */
export type LearnStep =
  | { ok: true; offset: number; before: number; after: number }
  | { ok: false; reason: 'invalid-page' | 'nothing-changed' | 'too-many-changes'; changed: number[] };

/** The one byte that changed between two reads, or why the step must be repeated. */
export function singleChange(before: Uint8Array, after: Uint8Array): LearnStep {
  if (!isValidPage(before) || !isValidPage(after)) return { ok: false, reason: 'invalid-page', changed: [] };
  const d = diffPages(before, after);
  if (d.length === 0) return { ok: false, reason: 'nothing-changed', changed: [] };
  if (d.length > 1) return { ok: false, reason: 'too-many-changes', changed: d.map((x) => x.offset) };
  return { ok: true, offset: d[0]!.offset, before: d[0]!.before, after: d[0]!.after };
}

export type LearnResult = { ok: true; layout: PageLayout } | { ok: false; reason: string };

/**
 * Combines the two observations. `effectStep` moved the effect byte; `brightnessStep` moved the
 * brightness byte of the live effect's slot, which places the per-effect table: two bytes per
 * effect, addressed by the 1-based effect value.
 */
export function inferLayout(effectStep: LearnStep, brightnessStep: LearnStep, liveEffect: number): LearnResult {
  if (!effectStep.ok || !brightnessStep.ok) return { ok: false, reason: 'Both observations must show exactly one changed byte.' };
  if (effectStep.offset === brightnessStep.offset)
    return { ok: false, reason: 'The same byte changed both times; press the effect key first, then the brightness key.' };
  if (liveEffect < 1) return { ok: false, reason: 'The effect byte is 0; choose a lighting effect on the keyboard first.' };
  const effectTable = brightnessStep.offset - (liveEffect - 1) * EFFECT_STRIDE;
  const end = SETTINGS_PAGE_BYTES - PAGE_MARKER.length;
  if (effectTable <= effectStep.offset || effectTable >= end)
    return { ok: false, reason: 'The brightness byte is not where a per-effect table can start; repeat on a different effect.' };
  return { ok: true, layout: { effect: effectStep.offset, sleep: null, effectTable } };
}

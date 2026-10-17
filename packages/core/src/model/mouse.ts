import type { SettingOption } from './settings.js';

/**
 * Gaming-mouse settings in one shape for every mouse adapter. Each adapter describes what its
 * firmware offers in a `MouseSchema`; the settings page renders only that.
 */
export interface MouseSettings {
  pollingRate: number;
  /** DPI of each level, in the firmware's order. */
  dpi: number[];
  /** Levels the DPI button cycles through. */
  dpiCount: number;
  /** Active level, 0-based. */
  dpiIndex: number;
  debounceMs: number;
  /** A `value` of `MouseSchema.sleep`. */
  sleep: number;
  /** On/off settings by id (`MouseSchema.flags`). */
  flags: Record<string, boolean>;
  /** A `value` of `MouseSchema.liftOff`, when the mouse has the setting. */
  liftOff?: number;
}

export interface MouseFlag {
  /** Stable id, also the translation key suffix (`mouse.flag.<id>`). */
  id: string;
  /** English label, used when no translation exists. */
  label: string;
}

export interface MouseSchema {
  pollingRates: number[];
  dpi: { min: number; max: number; step: number; levels: number };
  debounceMs: { min: number; max: number };
  sleep: SettingOption[];
  flags: MouseFlag[];
  liftOff?: SettingOption[];
  /** Whether the settings apply to the link in use only (cable and receiver keep their own). */
  perLink: boolean;
}

/** Implemented by mouse drivers next to the KeyboardDriver API. */
export interface MouseDriver {
  getMouseSchema(): MouseSchema;
  getMouseSettings(): Promise<MouseSettings>;
  /** Changes the given fields only and reads them back. */
  setMouseSettings(patch: Partial<MouseSettings>): Promise<void>;
}

export function isMouseDriver(d: unknown): d is MouseDriver {
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof (d as MouseDriver).getMouseSchema === 'function' &&
    typeof (d as MouseDriver).getMouseSettings === 'function'
  );
}

/** Checks a value against the schema before it is written; returns the problems found. */
export function mouseProblems(s: MouseSettings, schema: MouseSchema): string[] {
  const out: string[] = [];
  if (!schema.pollingRates.includes(s.pollingRate))
    out.push(`Polling rate must be one of ${schema.pollingRates.join(', ')} Hz.`);
  const { min, max } = schema.debounceMs;
  if (!Number.isInteger(s.debounceMs) || s.debounceMs < min || s.debounceMs > max)
    out.push(`Debounce must be ${min}–${max} ms.`);
  if (!schema.sleep.some((o) => o.value === s.sleep))
    out.push('Sleep must be one of the offered times.');
  const d = schema.dpi;
  if (
    s.dpi.length !== d.levels ||
    s.dpi.some((x) => !Number.isInteger(x) || x < d.min || x > d.max)
  )
    out.push(`Each DPI level must be ${d.min}–${d.max}.`);
  if (s.dpiCount < 1 || s.dpiCount > d.levels || s.dpiIndex < 0 || s.dpiIndex >= s.dpiCount)
    out.push('The active DPI level must be one of the enabled levels.');
  if (
    schema.liftOff &&
    s.liftOff !== undefined &&
    !schema.liftOff.some((o) => o.value === s.liftOff)
  )
    out.push('Lift-off distance must be one of the offered values.');
  for (const id of Object.keys(s.flags))
    if (!schema.flags.some((f) => f.id === id)) out.push(`Unknown setting ${id}.`);
  return out;
}

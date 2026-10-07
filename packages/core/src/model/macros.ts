export type MacroEvent =
  | { type: 'key'; usage: number; down: boolean }
  | { type: 'mouse'; button: 'left' | 'right' | 'middle'; down: boolean }
  | { type: 'delay'; ms: number };

export interface Macro {
  /** Firmware slot (0-based). */
  index: number;
  /** Names are host-side only; firmware does not store them. */
  name?: string;
  events: MacroEvent[];
}

export interface MacroLimits {
  slots: number;
  /** Total bytes of on-device macro storage, including the index table. */
  storageBytes: number;
  minDelayMs: number;
  maxDelayMs: number;
}

export function macroToText(m: Macro): string {
  return m.events
    .map((e) =>
      e.type === 'delay'
        ? `wait ${e.ms}ms`
        : e.type === 'key'
          ? `${e.down ? '↓' : '↑'}key 0x${e.usage.toString(16)}`
          : `${e.down ? '↓' : '↑'}mouse ${e.button}`,
    )
    .join(', ');
}

/** Ensures every key/mouse down has a matching up and delays are within limits. */
export function validateMacro(m: Macro, limits: MacroLimits): string[] {
  const problems: string[] = [];
  if (m.index < 0 || m.index >= limits.slots)
    problems.push(`slot ${m.index} outside 0..${limits.slots - 1}`);
  const held = new Map<string, number>();
  for (const e of m.events) {
    if (e.type === 'delay') {
      if (e.ms < limits.minDelayMs || e.ms > limits.maxDelayMs) {
        problems.push(`delay ${e.ms}ms outside ${limits.minDelayMs}..${limits.maxDelayMs}`);
      }
      continue;
    }
    const k = e.type === 'key' ? `k${e.usage}` : `m${e.button}`;
    held.set(k, (held.get(k) ?? 0) + (e.down ? 1 : -1));
  }
  for (const [k, n] of held) if (n !== 0) problems.push(`unbalanced press/release for ${k}`);
  return problems;
}

/**
 * Report-cadence statistics. OpenKey reports what it measured and keeps the declared USB interval
 * separate: a 1 ms bInterval is a ceiling the host may poll at, not proof of 1000 reports/s.
 */
export interface CadenceStats {
  samples: number;
  /** Intervals between consecutive timestamps, in ms. */
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  /** Standard deviation of the intervals. */
  jitterMs: number;
  /** Intervals longer than 1.5× the expected interval (only when an expected interval is given). */
  missed: number | null;
  /** 1000 / median interval; a measured figure, never a configured one. */
  measuredRateHz: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

/** Computes statistics from monotonically increasing timestamps (ms). Needs at least 2 samples. */
export function cadenceStats(
  timestampsMs: readonly number[],
  expectedIntervalMs?: number,
): CadenceStats | null {
  if (timestampsMs.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < timestampsMs.length; i++) {
    const d = timestampsMs[i]! - timestampsMs[i - 1]!;
    if (d >= 0) intervals.push(d);
  }
  if (intervals.length === 0) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
  const median = percentile(sorted, 50);
  return {
    samples: timestampsMs.length,
    meanMs: mean,
    medianMs: median,
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
    jitterMs: Math.sqrt(variance),
    missed: expectedIntervalMs
      ? intervals.filter((d) => d > expectedIntervalMs * 1.5).length
      : null,
    measuredRateHz: median > 0 ? 1000 / median : NaN,
  };
}

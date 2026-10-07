import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { KeyboardLayout, PhysicalKey } from '@openkey/core';

export interface KeyboardViewProps {
  layout: KeyboardLayout;
  /** Accessible name of the whole board. */
  label: string;
  selected?: number | null;
  /** Secondary legend per key (e.g. the remapped action). */
  legend?: (key: PhysicalKey) => string | undefined;
  /** Key fill colour (per-key RGB). */
  fill?: (key: PhysicalKey) => string | undefined;
  /** Marks keys with a changed or staged value. */
  highlight?: (key: PhysicalKey) => boolean;
  /** Marks keys currently held (tester). */
  pressed?: (key: PhysicalKey) => boolean;
  onKey?: (key: PhysicalKey) => void;
  onKeyDrag?: (key: PhysicalKey) => void;
}

const UNIT = 54;

/** Nearest key in a direction, by key centres; used for arrow-key navigation. */
function neighbour(keys: PhysicalKey[], from: PhysicalKey, dx: number, dy: number): PhysicalKey | undefined {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  let best: PhysicalKey | undefined;
  let bestScore = Infinity;
  for (const k of keys) {
    if (k === from) continue;
    const ex = k.x + k.w / 2 - cx;
    const ey = k.y + k.h / 2 - cy;
    const along = ex * dx + ey * dy;
    if (along <= 0.1) continue;
    const across = Math.abs(ex * dy - ey * dx);
    const score = along + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

/**
 * Renders any layout from key-unit geometry; no board-specific code lives here. One key is in the
 * tab order at a time (roving tabindex); arrow keys move between keys, Enter/Space selects.
 */
export function KeyboardView({ layout, label, selected, legend, fill, highlight, pressed, onKey, onKeyDrag }: KeyboardViewProps) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const refs = useRef(new Map<string, SVGGElement>());
  const w = layout.width * UNIT;
  const h = layout.height * UNIT;
  const interactive = !!onKey;
  const tabKey = focusId ?? layout.keys.find((k) => k.slot === selected)?.id ?? layout.keys[0]?.id;

  const onKeyDown = (k: PhysicalKey, e: KeyboardEvent) => {
    const dir: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = dir[e.key];
    if (d) {
      e.preventDefault();
      const n = neighbour(layout.keys, k, d[0], d[1]);
      if (n) {
        setFocusId(n.id);
        refs.current.get(n.id)?.focus();
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onKey?.(k);
    }
  };

  return (
    <div className="kb-wrap">
      <svg className="kb" viewBox={`-8 -8 ${w + 16} ${h + 16}`} role={interactive ? 'grid' : 'img'} aria-label={label}>
        <rect x={-8} y={-8} width={w + 16} height={h + 16} rx={16} className="kb-case" />
        {layout.keys.map((k) => {
          const x = k.x * UNIT + 2;
          const y = k.y * UNIT + 2;
          const kw = k.w * UNIT - 4;
          const kh = k.h * UNIT - 4;
          const color = fill?.(k);
          const sub = legend?.(k);
          const cls = [
            'kb-key',
            selected === k.slot ? 'is-selected' : '',
            highlight?.(k) ? 'is-staged' : '',
            pressed?.(k) ? 'is-pressed' : '',
          ].join(' ');
          return (
            <g
              key={k.id}
              ref={(el) => {
                if (el) refs.current.set(k.id, el);
                else refs.current.delete(k.id);
              }}
              className={cls}
              tabIndex={interactive ? (k.id === tabKey ? 0 : -1) : undefined}
              role={interactive ? 'gridcell' : undefined}
              aria-selected={interactive ? selected === k.slot : undefined}
              aria-label={interactive ? `${k.label}${sub ? `: ${sub}` : ''}` : undefined}
              onFocus={() => setFocusId(k.id)}
              onPointerDown={(e: PointerEvent) => {
                e.preventDefault();
                onKey?.(k);
              }}
              onPointerEnter={(e) => {
                if (e.buttons === 1) onKeyDrag?.(k);
              }}
              onKeyDown={(e) => onKeyDown(k, e)}
            >
              <rect x={x} y={y} width={kw} height={kh} rx={7} className="kb-cap" style={color ? { fill: color } : undefined} />
              <rect x={x + 4} y={y + 3} width={kw - 8} height={kh - 10} rx={5} className="kb-top" />
              <text x={x + 9} y={y + 19} className="kb-label">
                {k.label}
              </text>
              {sub && (
                <text x={x + kw / 2} y={y + kh - 10} className="kb-sub" textAnchor="middle">
                  {sub.length > 10 ? `${sub.slice(0, 9)}…` : sub}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

import type { KeyboardLayout, PhysicalKey } from '@openak820/core';

export interface KeyboardViewProps {
  layout: KeyboardLayout;
  selected?: number | null;
  /** Secondary label per slot (e.g. the remapped action). */
  legend?: (key: PhysicalKey) => string | undefined;
  /** Key fill colour (per-key RGB). */
  fill?: (key: PhysicalKey) => string | undefined;
  highlight?: (key: PhysicalKey) => boolean;
  onKey?: (key: PhysicalKey, e: React.PointerEvent) => void;
  onKeyDrag?: (key: PhysicalKey) => void;
}

const UNIT = 54;

/** Renders any layout from key-unit geometry; no board-specific code lives here. */
export function KeyboardView({
  layout,
  selected,
  legend,
  fill,
  highlight,
  onKey,
  onKeyDrag,
}: KeyboardViewProps) {
  const w = layout.width * UNIT;
  const h = layout.height * UNIT;
  return (
    <div className="kb-wrap">
      <svg
        className="kb"
        viewBox={`-6 -6 ${w + 12} ${h + 12}`}
        role="group"
        aria-label={layout.name}
      >
        <rect x={-6} y={-6} width={w + 12} height={h + 12} rx={14} className="kb-case" />
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
            highlight?.(k) ? 'is-highlight' : '',
          ].join(' ');
          return (
            <g
              key={k.id}
              className={cls}
              tabIndex={onKey ? 0 : -1}
              role={onKey ? 'button' : undefined}
              aria-label={`${k.label}${sub ? `: ${sub}` : ''}`}
              onPointerDown={(e) => onKey?.(k, e)}
              onPointerEnter={(e) => {
                if (e.buttons === 1) onKeyDrag?.(k);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ')
                  onKey?.(k, e as unknown as React.PointerEvent);
              }}
            >
              <rect
                x={x}
                y={y}
                width={kw}
                height={kh}
                rx={6}
                className="kb-cap"
                style={color ? { fill: color } : undefined}
              />
              <text x={x + 7} y={y + 17} className="kb-label">
                {k.label}
              </text>
              {sub && (
                <text x={x + kw / 2} y={y + kh - 8} className="kb-sub" textAnchor="middle">
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

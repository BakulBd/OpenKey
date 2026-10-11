import { useEffect, useRef } from 'react';

const SCREEN = 96;
const SHOWS = ['kitty', 'plasma', 'kitty-walk', 'aurora'] as const;

/** Row lengths of a compact 75 % board, in 1u keys; the last key of each row is widened. */
const ROWS = [14, 14, 14, 13, 12];

/**
 * Hero illustration: a keyboard whose screen plays OpenKey's own gallery animations and whose keys
 * glow in a slow wave. Drawn locally (SVG + one canvas); the animation code loads after first paint
 * and stops for reduced-motion users.
 */
export function HeroVisual() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer = 0;
    let alive = true;
    void import('@openkey/tft').then(({ renderGallery, galleryAnimation }) => {
      if (!alive) return;
      const clips = SHOWS.map((id) => ({ frames: renderGallery(id, SCREEN, SCREEN), delay: galleryAnimation(id)!.delayMs }));
      let clip = 0;
      let i = 0;
      let shown = 0;
      const draw = () => {
        const f = clips[clip]!.frames[i]!;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(f.image.data), SCREEN, SCREEN), 0, 0);
      };
      draw();
      if (still) return;
      const tick = () => {
        i = (i + 1) % clips[clip]!.frames.length;
        shown += clips[clip]!.delay;
        // Each animation plays for about four seconds, then the next one starts.
        if (shown > 4000 && i === 0) {
          clip = (clip + 1) % clips.length;
          shown = 0;
        }
        draw();
        timer = window.setTimeout(tick, clips[clip]!.delay);
      };
      timer = window.setTimeout(tick, clips[0]!.delay);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const u = 26;
  const gap = 4;
  const w = 15 * u + 2 * 18;
  return (
    <div className="hero-visual" aria-hidden="true">
      <svg viewBox={`0 0 ${w + 150} ${5 * u + 60}`} className="hero-kb">
        <defs>
          <linearGradient id="hv-case" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--hv-case-top)" />
            <stop offset="1" stopColor="var(--hv-case-bottom)" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width={w + 146} height={5 * u + 56} rx="18" fill="url(#hv-case)" stroke="var(--border)" strokeWidth="2" />
        {ROWS.flatMap((n, r) =>
          Array.from({ length: n }, (_, c) => {
            const wide = c === n - 1 ? (15 - n) * u + u : u;
            const x = 18 + c * u;
            return (
              <rect
                key={`${r}-${c}`}
                className="hv-key"
                style={{ animationDelay: `${(c + r) * 0.09}s` }}
                x={x + gap / 2}
                y={22 + r * u + gap / 2}
                width={wide - gap}
                height={u - gap}
                rx="5"
              />
            );
          }),
        )}
        <rect x={w + 10} y="22" width="118" height="118" rx="12" fill="#07080c" />
        <circle cx={w + 69} cy={5 * u + 30} r="12" className="hv-knob" />
      </svg>
      <canvas
        ref={ref}
        width={SCREEN}
        height={SCREEN}
        className="hero-screen"
        style={{ left: `${((w + 21) / (w + 150)) * 100}%`, top: `${(33 / (5 * u + 60)) * 100}%`, width: `${(96 / (w + 150)) * 100}%` }}
      />
    </div>
  );
}

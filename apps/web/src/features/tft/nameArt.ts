import type { AnimationFrame } from '@openkey/tft';

/**
 * Name Studio: animated name cards for keyboard screens, drawn with the browser's canvas so any
 * script works (Latin, Bangla, CJK …) with the system's fonts. Every style is a loop: frame N wraps
 * to frame 0. Rendering is local; nothing is sent anywhere until the user uploads.
 */
export interface NameStyle {
  id: string;
  name: string;
  description: string;
  frames: number;
  delayMs: number;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, text: string): void;
}

const TAU = Math.PI * 2;
const FONT = "800 {size}px system-ui, 'Segoe UI', 'Noto Sans', 'Noto Sans Bengali', 'Hind Siliguri', sans-serif";
export const DEFAULT_NAME = 'Bakul';

/** Largest font size (px) at which `text` fits `maxWidth`, capped at `maxSize`. */
export function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxSize: number): number {
  let size = maxSize;
  for (; size > 8; size -= 1) {
    ctx.font = FONT.replace('{size}', String(size));
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  ctx.font = FONT.replace('{size}', String(size));
  return size;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), a | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function centered(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, maxSize: number, dy = 0): number {
  const size = fitFont(ctx, text, w * 0.86, maxSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + dy);
  return size;
}

function stars(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, n: number, seed: number): void {
  const r = seeded(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w;
    const y = r() * h;
    const p = r();
    const a = 0.25 + 0.75 * Math.sin(TAU * (t + p)) ** 2;
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.fillRect(Math.round(x), Math.round(y), r() < 0.2 ? 2 : 1, 1);
  }
}

export const NAME_STYLES: readonly NameStyle[] = [
  {
    id: 'neon',
    name: 'Neon Pulse',
    description: 'Glowing neon sign that breathes through the colours.',
    frames: 30,
    delayMs: 60,
    draw(ctx, w, h, t, text) {
      ctx.fillStyle = '#07040f';
      ctx.fillRect(0, 0, w, h);
      const hue = Math.round(300 + 60 * Math.sin(TAU * t));
      const glow = 6 + 10 * (0.5 + 0.5 * Math.sin(TAU * t * 2));
      ctx.shadowColor = `hsl(${hue} 100% 60%)`;
      ctx.shadowBlur = glow;
      ctx.fillStyle = `hsl(${hue} 100% 85%)`;
      centered(ctx, text, w, h, h * 0.42);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `hsl(${(hue + 180) % 360} 100% 60% / 0.7)`;
      ctx.lineWidth = 2;
      ctx.strokeRect(5, 5, w - 10, h - 10);
    },
  },
  {
    id: 'rainbow',
    name: 'Rainbow Wave',
    description: 'Every letter rides a wave in its own colour.',
    frames: 32,
    delayMs: 55,
    draw(ctx, w, h, t, text) {
      ctx.fillStyle = '#0b0d1a';
      ctx.fillRect(0, 0, w, h);
      const letters = [...text];
      const size = fitFont(ctx, text, w * 0.86, h * 0.4);
      const total = ctx.measureText(text).width;
      let x = (w - total) / 2;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      letters.forEach((ch, i) => {
        const y = h / 2 + Math.sin(TAU * (t - i / Math.max(letters.length, 6))) * size * 0.22;
        ctx.fillStyle = `hsl(${Math.round(360 * ((i / letters.length + t) % 1))} 95% 62%)`;
        ctx.fillText(ch, x, y);
        x += ctx.measureText(ch).width;
      });
    },
  },
  {
    id: 'galaxy',
    name: 'Galaxy Dream',
    description: 'Cosmic gradient lettering over twinkling stars.',
    frames: 30,
    delayMs: 70,
    draw(ctx, w, h, t, text) {
      const bg = ctx.createRadialGradient(w * 0.5, h * 0.5, 4, w * 0.5, h * 0.5, w * 0.75);
      bg.addColorStop(0, '#2a1250');
      bg.addColorStop(1, '#03020a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      stars(ctx, w, h, t, 40, 7);
      const shift = Math.sin(TAU * t) * w * 0.5;
      const g = ctx.createLinearGradient(shift, 0, w + shift, h);
      g.addColorStop(0, '#7af5ff');
      g.addColorStop(0.5, '#c58bff');
      g.addColorStop(1, '#ff7ad9');
      ctx.fillStyle = g;
      ctx.shadowColor = '#b48bff';
      ctx.shadowBlur = 8;
      centered(ctx, text, w, h, h * 0.4);
      ctx.shadowBlur = 0;
    },
  },
  {
    id: 'typewriter',
    name: 'Typewriter',
    description: 'Types your name letter by letter, cursor blinking.',
    frames: 36,
    delayMs: 90,
    draw(ctx, w, h, t, text) {
      ctx.fillStyle = '#101418';
      ctx.fillRect(0, 0, w, h);
      const letters = [...text];
      // Type during the first 70 % of the loop, then hold the whole name.
      const shown = Math.min(letters.length, Math.floor((t / 0.7) * letters.length) + 1);
      const size = fitFont(ctx, text + '_', w * 0.86, h * 0.34);
      const visible = letters.slice(0, shown).join('');
      const full = ctx.measureText(text).width;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#b6f7c1';
      const x0 = (w - full) / 2;
      ctx.fillText(visible, x0, h / 2);
      if (Math.floor(t * 12) % 2 === 0) ctx.fillRect(x0 + ctx.measureText(visible).width + 2, h / 2 - size * 0.42, Math.max(2, size * 0.1), size * 0.84);
    },
  },
  {
    id: 'fire',
    name: 'Blaze',
    description: 'Flickering fire lettering with rising embers.',
    frames: 30,
    delayMs: 60,
    draw(ctx, w, h, t, text) {
      ctx.fillStyle = '#120400';
      ctx.fillRect(0, 0, w, h);
      const r = seeded(11);
      for (let i = 0; i < 26; i++) {
        const x = r() * w;
        const y = h - ((r() + t) % 1) * h;
        ctx.fillStyle = `rgba(255,${Math.round(120 + 100 * r())},40,${(0.4 + 0.6 * r()).toFixed(2)})`;
        ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
      }
      const flicker = 0.5 + 0.5 * Math.sin(TAU * t * 3);
      const g = ctx.createLinearGradient(0, h * 0.3, 0, h * 0.7);
      g.addColorStop(0, '#fff3a0');
      g.addColorStop(0.5, '#ffa21f');
      g.addColorStop(1, '#ff3d00');
      ctx.fillStyle = g;
      ctx.shadowColor = '#ff5a00';
      ctx.shadowBlur = 6 + 8 * flicker;
      centered(ctx, text, w, h, h * 0.42);
      ctx.shadowBlur = 0;
    },
  },
  {
    id: 'marquee',
    name: 'LED Marquee',
    description: 'Scrolling LED sign; best for long names.',
    frames: 48,
    delayMs: 45,
    draw(ctx, w, h, t, text) {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, w, h);
      const size = Math.round(h * 0.42);
      ctx.font = FONT.replace('{size}', String(size));
      // One period = the text plus a gap; a second copy follows, so the loop is seamless and the
      // name is on screen from the first frame.
      const tw = Math.max(ctx.measureText(text).width + w * 0.45, w);
      const x = w * 0.08 - t * tw;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffcc33';
      ctx.shadowColor = '#ff9900';
      ctx.shadowBlur = 6;
      ctx.fillText(text, x, h / 2);
      ctx.fillText(text, x + tw, h / 2);
      ctx.shadowBlur = 0;
      // Dot-matrix screen: darken the gaps between LEDs.
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      for (let i = 0; i < w; i += 3) ctx.fillRect(i, 0, 1, h);
      for (let j = 0; j < h; j += 3) ctx.fillRect(0, j, w, 1);
    },
  },
  {
    id: 'love',
    name: 'Love Beat',
    description: 'Your name with hearts beating around it.',
    frames: 30,
    delayMs: 50,
    draw(ctx, w, h, t, text) {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#ffd1e4');
      bg.addColorStop(1, '#ff8fb8');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const beat = Math.exp(-((((t * 2) % 1) - 0.15) ** 2) * 90);
      ctx.fillStyle = '#e8175d';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = FONT.replace('{size}', String(Math.round(h * (0.16 + 0.05 * beat))));
      for (const [x, y] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.82], [0.8, 0.82]] as const) ctx.fillText('♥', w * x, h * y);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#c2185b';
      ctx.shadowBlur = 4;
      centered(ctx, text, w, h, h * 0.34);
      ctx.shadowBlur = 0;
    },
  },
  {
    id: 'glitch',
    name: 'Cyber Glitch',
    description: 'Hacker-style RGB split and scanlines.',
    frames: 24,
    delayMs: 70,
    draw(ctx, w, h, t, text) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      const r = seeded(Math.floor(t * 24) + 3);
      const jump = r() < 0.35 ? (r() - 0.5) * 8 : 0;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ff0040';
      centered(ctx, text, w + jump * 2, h, h * 0.4, -1);
      ctx.fillStyle = '#00e5ff';
      ctx.save();
      ctx.translate(-2 - jump, 1);
      centered(ctx, text, w, h, h * 0.4);
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let y = Math.floor(t * 8) % 2; y < h; y += 2) ctx.fillRect(0, y, w, 1);
    },
  },
  {
    id: 'gold',
    name: 'Royal Gold',
    description: 'Polished gold lettering with a light sweep and sparkles.',
    frames: 32,
    delayMs: 60,
    draw(ctx, w, h, t, text) {
      ctx.fillStyle = '#140d02';
      ctx.fillRect(0, 0, w, h);
      const sweep = -w + t * w * 3;
      const g = ctx.createLinearGradient(sweep, 0, sweep + w * 0.6, h);
      g.addColorStop(0, '#9c6b12');
      g.addColorStop(0.45, '#f6d365');
      g.addColorStop(0.5, '#fffbe6');
      g.addColorStop(0.55, '#f6d365');
      g.addColorStop(1, '#9c6b12');
      ctx.fillStyle = g;
      centered(ctx, text, w, h, h * 0.42);
      const r = seeded(5);
      for (let i = 0; i < 6; i++) {
        const a = Math.max(0, Math.sin(TAU * (t + r())));
        const x = w * (0.1 + 0.8 * r());
        const y = h * (0.15 + 0.7 * r());
        ctx.fillStyle = `rgba(255,248,200,${a.toFixed(2)})`;
        ctx.fillRect(x - 3 * a, y, 6 * a + 1, 1);
        ctx.fillRect(x, y - 3 * a, 1, 6 * a + 1);
      }
    },
  },
  {
    id: 'matrix',
    name: 'Matrix Code',
    description: 'Green code rain with your name in the middle.',
    frames: 30,
    delayMs: 60,
    draw(ctx, w, h, t, text) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      const r = seeded(21);
      ctx.font = `700 9px ui-monospace, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (let x = 0; x < w; x += 8) {
        const speed = 1 + Math.floor(r() * 2);
        const head = (((r() + t * speed) % 1) * (h + 40)) - 20;
        for (let k = 0; k < 6; k++) {
          const y = head - k * 9;
          ctx.fillStyle = k === 0 ? '#d7ffd9' : `rgba(0,255,90,${(0.8 - k * 0.13).toFixed(2)})`;
          ctx.fillText(String.fromCharCode(0x30a0 + Math.floor(r() * 90)), x, y);
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, h * 0.32, w, h * 0.36);
      ctx.fillStyle = '#39ff6a';
      ctx.shadowColor = '#00ff55';
      ctx.shadowBlur = 6;
      centered(ctx, text, w, h, h * 0.34);
      ctx.shadowBlur = 0;
    },
  },
];

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return c.getContext('2d', { willReadFrequently: true }) as unknown as CanvasRenderingContext2D;
}

/** Renders a style for `text` at the screen's size, ready for the upload pipeline. */
export function renderNameArt(styleId: string, text: string, w: number, h: number, frames?: number): AnimationFrame[] {
  const style = NAME_STYLES.find((s) => s.id === styleId);
  if (!style) throw new Error(`Unknown style ${styleId}`);
  const name = text.trim() || DEFAULT_NAME;
  const n = frames ?? style.frames;
  const ctx = canvas(w, h);
  return Array.from({ length: n }, (_, i) => {
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    style.draw(ctx, w, h, i / n, name);
    ctx.restore();
    const img = ctx.getImageData(0, 0, w, h);
    return { image: { width: w, height: h, data: new Uint8ClampedArray(img.data) }, delayMs: style.delayMs };
  });
}

import { useEffect, useRef, useState } from 'react';
import { CATALOG } from '@openkey/devices';
import type { AnimationFrame } from '@openkey/tft';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { DEFAULT_NAME, NAME_STYLES, renderNameArt } from './nameArt.js';
import type { NameStyle } from './nameArt.js';

const THUMB = 64;
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function StyleThumb({ style, text, label }: { style: NameStyle; text: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const frames = renderNameArt(style.id, text, THUMB, THUMB, Math.min(style.frames, 24));
    let i = 0;
    const draw = () => ctx.putImageData(new ImageData(new Uint8ClampedArray(frames[i]!.image.data), THUMB, THUMB), 0, 0);
    draw();
    if (reducedMotion()) return;
    const timer = setInterval(() => {
      i = (i + 1) % frames.length;
      draw();
    }, (style.delayMs * style.frames) / frames.length);
    return () => clearInterval(timer);
  }, [style, text]);
  return <canvas ref={ref} width={THUMB} height={THUMB} className="gallery-canvas" role="img" aria-label={label} />;
}

const STATUS_KEY: Record<string, MessageKey> = {
  verified: 'name.screen.verified',
  experimental: 'name.screen.experimental',
  community: 'name.screen.community',
  research: 'name.screen.research',
  unsupported: 'name.screen.unsupported',
};

/** Which catalogued keyboards have a screen, and how far uploading to it is established. */
export function ScreenSupport() {
  const t = useT();
  const screens = CATALOG.filter((e) => e.hardware.tft);
  return (
    <details className="small screen-support">
      <summary>{t('name.screens')}</summary>
      <ul>
        {screens.map((e) => (
          <li key={`${e.vendorId}:${e.productId}:${e.productName ?? ''}:${e.link}`}>
            <strong>
              {e.brand} {e.model}
            </strong>{' '}
            <code className="muted">
              {e.vendorId.toString(16).toUpperCase().padStart(4, '0')}:{e.productId.toString(16).toUpperCase().padStart(4, '0')}
            </code>{' '}
            — {t(STATUS_KEY[e.status] ?? 'name.screen.research')}
            {e.link !== 'usb' ? ` (${e.link})` : ''}
          </li>
        ))}
      </ul>
      <p className="muted">{t('name.screensNote')}</p>
    </details>
  );
}

/** Animated name cards: type a name, pick a style, load it into the preview, then upload. */
export function NameStudio({ width, height, selected, onUse }: { width: number; height: number; selected: string | null; onUse: (id: string, frames: AnimationFrame[]) => void }) {
  const t = useT();
  const { device } = useKeyboard();
  const [text, setText] = useState(DEFAULT_NAME);
  const [shown, setShown] = useState(DEFAULT_NAME);
  // Re-render the previews shortly after typing stops.
  useEffect(() => {
    const id = setTimeout(() => setShown(text.trim() || DEFAULT_NAME), 250);
    return () => clearTimeout(id);
  }, [text]);
  const canUpload = !!device && (device.caps.tftGif.write || device.caps.tft.write);
  return (
    <div className="name-studio">
      <p className="small muted">{t('name.lead')}</p>
      <label className="name-input">
        <span>{t('name.label')}</span>
        <input type="text" value={text} maxLength={24} onChange={(e) => setText(e.target.value)} placeholder={DEFAULT_NAME} />
      </label>
      {!canUpload && <p className="callout info small">{t('name.noScreen')}</p>}
      <ul className="gallery">
        {NAME_STYLES.map((s) => {
          const id = `name:${s.id}`;
          const on = selected === id;
          return (
            <li key={s.id} className={`gallery-item ${on ? 'on' : ''}`}>
              <StyleThumb style={s} text={shown} label={t('gallery.preview', { name: `${s.name}: ${shown}` })} />
              <div className="gallery-meta">
                <strong>{s.name}</strong>
                <span className="small muted">{s.description}</span>
                <span className="small muted">{t('gallery.facts', { frames: s.frames, s: ((s.frames * s.delayMs) / 1000).toFixed(1), kib: ((s.frames * width * height * 2) / 1024).toFixed(0) })}</span>
              </div>
              <button type="button" className={`btn small ${on ? 'primary' : ''}`} aria-pressed={on} onClick={() => onUse(id, renderNameArt(s.id, shown, width, height))}>
                {on ? t('gallery.selected') : t('gallery.use')}
              </button>
            </li>
          );
        })}
      </ul>
      <ScreenSupport />
    </div>
  );
}

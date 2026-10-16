import { useEffect, useMemo, useRef, useState } from 'react';
import { GALLERY, GALLERY_CATEGORIES, decodeGif, renderGallery } from '@openkey/tft';
import type { AnimationFrame, GalleryAnimation, GalleryCategory } from '@openkey/tft';
import { useT } from '../../i18n/i18n.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { readPref, writePref } from '../../state/prefs.js';
import { Icon } from '../../components/Icon.js';
import { PUBLIC_GIFS, gifUrl } from './public-gifs.js';
import { NameStudio } from './NameStudio.js';
import type { PublicGif } from './public-gifs.js';

/** Thumbnails are rendered small; "Use" renders at the panel's real size. */
const THUMB = 64;

const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function Thumb({ a, label, order }: { a: GalleryAnimation; label: string; order: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [frames, setFrames] = useState<AnimationFrame[] | null>(null);
  const [visible, setVisible] = useState(false);

  // Render lazily, once the card scrolls into view.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), {
      rootMargin: '100px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Render every thumbnail soon after the page opens (a few milliseconds each, staggered so the
  // page stays responsive); only animation waits for visibility.
  useEffect(() => {
    if (frames) return;
    const id = setTimeout(
      () => setFrames(renderGallery(a.id, THUMB, THUMB)),
      visible ? 0 : 150 + order * 60,
    );
    return () => clearTimeout(id);
  }, [visible, frames, a.id, order]);

  // Animate only while visible, and not at all for reduced-motion users.
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx || !frames) return;
    let i = 0;
    const draw = () =>
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(frames[i]!.image.data), THUMB, THUMB),
        0,
        0,
      );
    draw();
    if (!visible || reducedMotion()) return;
    const timer = setInterval(() => {
      i = (i + 1) % frames.length;
      draw();
    }, a.delayMs);
    return () => clearInterval(timer);
  }, [frames, visible, a.delayMs]);

  return (
    <canvas
      ref={ref}
      width={THUMB}
      height={THUMB}
      className={`gallery-canvas ${frames ? '' : 'loading'}`}
      role="img"
      aria-label={label}
    />
  );
}

/** A public-domain GIF: the browser animates the file itself; reduced motion shows it paused. */
function GifThumb({ g, label }: { g: PublicGif; label: string }) {
  const still = reducedMotion();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!still) return;
    // Reduced motion: draw only the first frame.
    let alive = true;
    void fetch(gifUrl(g))
      .then((r) => r.arrayBuffer())
      .then((b) => {
        const f = decodeGif(new Uint8Array(b))[0];
        const ctx = ref.current?.getContext('2d');
        if (!alive || !f || !ctx) return;
        ctx.putImageData(
          new ImageData(new Uint8ClampedArray(f.image.data), f.image.width, f.image.height),
          0,
          0,
        );
      })
      .catch(() => undefined);
    return () => void (alive = false);
  }, [g, still]);
  return still ? (
    <canvas
      ref={ref}
      width={128}
      height={128}
      className="gallery-canvas"
      role="img"
      aria-label={label}
    />
  ) : (
    <img
      src={gifUrl(g)}
      width={THUMB}
      height={THUMB}
      loading="lazy"
      decoding="async"
      className="gallery-canvas"
      alt={label}
    />
  );
}

type Source = 'made' | 'name' | 'public';
type Filter = 'all' | 'favourites' | GalleryCategory;

/** Favourites are a per-viewer convenience: kept in this browser only, empty when storage is off. */
function useFavourites(): [Set<string>, (id: string) => void] {
  const [favs, setFavs] = useState<Set<string>>(() => {
    try {
      const v: unknown = JSON.parse(readPref('gallery.favourites') ?? '[]');
      return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) =>
    setFavs((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      writePref('gallery.favourites', JSON.stringify([...next]));
      return next;
    });
  return [favs, toggle];
}

/** "Fits" or "trimmed to N frames", for the connected screen's frame budget. */
function FrameFit({ frames, max }: { frames: number; max?: number }) {
  const t = useT();
  if (!max) return null;
  return frames <= max ? (
    <span className="pill tiny cs-verified">{t('gallery.fits')}</span>
  ) : (
    <span className="pill tiny cs-research">{t('gallery.trimmed', { n: max })}</span>
  );
}

function FavButton({ on, name, onClick }: { on: boolean; name: string; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className={`btn ghost icon-only small fav ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={t(on ? 'gallery.unfav' : 'gallery.fav', { name })}
      title={t(on ? 'gallery.unfav' : 'gallery.fav', { name })}
      onClick={onClick}
    >
      <Icon name="heart" size={16} />
    </button>
  );
}

/**
 * Animation gallery for the keyboard screen: animations generated by OpenKey's own code, and
 * public-domain GIFs from Wikimedia Commons. Both are free to use. Choosing one only loads it into
 * the local preview; nothing reaches the keyboard until Upload.
 */
export function Gallery({
  width,
  height,
  maxFrames,
  selected,
  onUse,
}: {
  width: number;
  height: number;
  /** The connected screen's frame budget, when known. */
  maxFrames?: number;
  selected: string | null;
  onUse: (id: string, frames: AnimationFrame[]) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Source>('made');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [favs, toggleFav] = useFavourites();
  const [made, gifs] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const keep = (id: string, text: string, category: GalleryCategory) =>
      (filter !== 'favourites' || favs.has(id)) &&
      (filter === 'all' || filter === 'favourites' || category === filter) &&
      (!q || `${text} ${category}`.toLowerCase().includes(q));
    return [
      GALLERY.filter((a) => keep(a.id, `${a.name} ${a.description}`, a.category)),
      PUBLIC_GIFS.filter((g) => keep(`gif:${g.id}`, `${g.name} ${g.author}`, g.category)),
    ] as const;
  }, [filter, query, favs]);
  const [loading, setLoading] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const pickGif = async (g: PublicGif) => {
    setLoading(g.id);
    setFailed(null);
    try {
      const r = await fetch(gifUrl(g));
      if (!r.ok) throw new Error(String(r.status));
      onUse(`gif:${g.id}`, decodeGif(new Uint8Array(await r.arrayBuffer())));
    } catch {
      setFailed(g.id);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div>
      <div className="tabs" role="tablist" aria-label={t('gallery.title')}>
        {(['made', 'name', 'public'] as const).map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={tab === x}
            className={`tab ${tab === x ? 'on' : ''}`}
            onClick={() => setTab(x)}
          >
            {t(`gallery.tab.${x}`)}
          </button>
        ))}
      </div>
      {tab !== 'name' && (
        <>
          <p className="small muted">{t(tab === 'made' ? 'gallery.lead' : 'gallery.publicLead')}</p>
          <div className="gallery-tools">
            <label className="search">
              <Icon name="search" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('gallery.search')}
                aria-label={t('gallery.search')}
              />
            </label>
            <div className="chips wrap" role="group" aria-label={t('gallery.categories')}>
              {(['all', 'favourites', ...GALLERY_CATEGORIES] as Filter[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`chip ${filter === c ? 'on' : ''}`}
                  aria-pressed={filter === c}
                  onClick={() => setFilter(c)}
                >
                  {t(`gallery.cat.${c}` as MessageKey)}
                  {c === 'favourites' && favs.size > 0 ? ` (${favs.size})` : ''}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {tab === 'name' ? (
        <NameStudio width={width} height={height} selected={selected} onUse={onUse} />
      ) : tab === 'made' ? (
        <ul className="gallery">
          {made.length === 0 && <li className="small muted">{t('gallery.empty')}</li>}
          {made.map((a, order) => {
            const kib = (a.frames * width * height * 2) / 1024;
            const on = selected === a.id;
            return (
              <li key={a.id} className={`gallery-item ${on ? 'on' : ''}`}>
                <Thumb a={a} order={order} label={t('gallery.preview', { name: a.name })} />
                <div className="gallery-meta">
                  <strong>{a.name}</strong>
                  <span className="small muted">{a.description}</span>
                  <span className="small muted">
                    {t('gallery.facts', {
                      frames: a.frames,
                      s: ((a.frames * a.delayMs) / 1000).toFixed(1),
                      kib: kib.toFixed(0),
                    })}{' '}
                    <FrameFit frames={a.frames} {...(maxFrames ? { max: maxFrames } : {})} />
                  </span>
                </div>
                <FavButton on={favs.has(a.id)} name={a.name} onClick={() => toggleFav(a.id)} />
                <button
                  type="button"
                  className={`btn small ${on ? 'primary' : ''}`}
                  aria-pressed={on}
                  onClick={() => onUse(a.id, renderGallery(a.id, width, height))}
                >
                  {on ? t('gallery.selected') : t('gallery.use')}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="gallery">
          {gifs.length === 0 && <li className="small muted">{t('gallery.empty')}</li>}
          {gifs.map((g) => {
            const on = selected === `gif:${g.id}`;
            const kib = (g.frames * width * height * 2) / 1024;
            return (
              <li key={g.id} className={`gallery-item ${on ? 'on' : ''}`}>
                <GifThumb g={g} label={t('gallery.preview', { name: g.name })} />
                <div className="gallery-meta">
                  <strong>{g.name}</strong>
                  <span className="small muted">
                    {g.license} · {g.author} ·{' '}
                    <a href={g.source} target="_blank" rel="noopener noreferrer">
                      {t('gallery.source')}
                    </a>
                  </span>
                  <span className="small muted">
                    {t('gallery.facts', {
                      frames: g.frames,
                      s: (g.loopMs / 1000).toFixed(1),
                      kib: kib.toFixed(0),
                    })}{' '}
                    <FrameFit frames={g.frames} {...(maxFrames ? { max: maxFrames } : {})} />
                  </span>
                  {failed === g.id && <span className="small">{t('gallery.loadFailed')}</span>}
                </div>
                <FavButton
                  on={favs.has(`gif:${g.id}`)}
                  name={g.name}
                  onClick={() => toggleFav(`gif:${g.id}`)}
                />
                <button
                  type="button"
                  className={`btn small ${on ? 'primary' : ''}`}
                  aria-pressed={on}
                  disabled={loading === g.id}
                  onClick={() => void pickGif(g)}
                >
                  {on ? t('gallery.selected') : t('gallery.use')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

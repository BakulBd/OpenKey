import { useEffect, useRef, useState } from 'react';
import type { TftFrame, TftInfo, Transaction, TxOutcome, UploadProgress } from '@openkey/core';
import {
  applyLoop,
  decodeGif,
  fromRgb565le,
  pattern,
  prepareAnimation,
  redBlueAnimation,
  retime,
  rotateImage,
  slideshow,
} from '@openkey/tft';
import type { LoopStyle } from '@openkey/tft';
import type { AnimationFrame, FitMode, PatternName } from '@openkey/tft';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import {
  Card,
  Field,
  FileButton,
  KV,
  Loading,
  PageHeader,
  SourceNote,
  Spinner,
} from '../../components/ui.js';
import type { MessageKey } from '../../i18n/i18n.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';
import { newId, saveRecord } from '../../state/db.js';
import { Gallery } from './Gallery.js';

/** Inputs larger than this are refused before decoding: the panel is tiny and decoding is in-memory. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const PATTERNS: (PatternName | 'red-blue')[] = [
  'red',
  'green',
  'blue',
  'white',
  'black',
  'checkerboard',
  'gradient',
  'quadrants',
  'red-blue',
];

async function decodeFile(file: File): Promise<AnimationFrame[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === 'image/gif' || (bytes[0] === 0x47 && bytes[1] === 0x49))
    return decodeGif(bytes);
  const bmp = await createImageBitmap(file);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return [{ image: { width: d.width, height: d.height, data: d.data }, delayMs: 0 }];
}

function Preview({ frame, info, label }: { frame: TftFrame; info: TftInfo; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = fromRgb565le(frame.pixels, info.width, info.height);
    ref.current
      ?.getContext('2d')
      ?.putImageData(new ImageData(new Uint8ClampedArray(img.data), info.width, info.height), 0, 0);
  }, [frame, info]);
  return (
    <canvas
      ref={ref}
      width={info.width}
      height={info.height}
      className="tft-canvas"
      role="img"
      aria-label={label}
    />
  );
}

/**
 * Screen studio. All processing is local; only Upload writes. Uploads replace the keyboard's custom
 * animation, which the firmware cannot export, so a TFT upload is always confirmed as high risk.
 */
export default function TftStudio() {
  const t = useT();
  const { device, read, apply, gate, notify, operation } = useKeyboard();
  const [outcome, setOutcome] = useState<TxOutcome | null>(null);
  const [clockOutcome, setClockOutcome] = useState<TxOutcome | null>(null);
  const [galleryId, setGalleryId] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<TftInfo | null>(null);
  const [source, setSource] = useState<AnimationFrame[]>([]);
  const [fit, setFit] = useState<FitMode>('cover');
  const [dither, setDither] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState<LoopStyle>('normal');
  const [frames, setFrames] = useState<TftFrame[]>([]);
  const [stats, setStats] = useState<{ dropped: number; clamped: number }>({
    dropped: 0,
    clamped: 0,
  });
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [current, setCurrent] = useState(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!device?.caps.tft.write) return;
    void read(t('tft.read'), (d) => d.getTftInfo()).then((i) => i && setInfo(i));
  }, [device, read, t]);
  useEffect(() => {
    if (!info || !source.length) return;
    const rotated = applyLoop(retime(source, speed), loop).map((f) => ({
      ...f,
      image: rotateImage(f.image, rotation),
    }));
    const r = prepareAnimation(rotated, info, { fit, dither });
    setFrames(r.frames);
    setStats({ dropped: r.dropped, clamped: r.clampedDelays });
    setCurrent(0);
  }, [source, info, fit, dither, rotation, speed, loop]);
  useEffect(() => {
    if (frames.length < 2) return;
    const id = setTimeout(
      () => setCurrent((c) => (c + 1) % frames.length),
      Math.max(30, frames[current]?.delayMs ?? 100),
    );
    return () => clearTimeout(id);
  }, [frames, current]);

  if (!device) return null;
  const caps = device.caps;

  const upload = async () => {
    abort.current = new AbortController();
    const signal = abort.current.signal;
    const tx: Transaction<TftFrame[]> = {
      label: t('tft.upload'),
      acknowledged: true,
      apply: (fs) =>
        fs.length === 1
          ? device.driver.uploadTftImage(fs[0]!, setProgress, { signal })
          : device.driver.uploadTftGif(fs, setProgress, { signal }),
    };
    const r = await apply(frames.length === 1 ? 'tft' : 'tftGif', tx, undefined, frames);
    if (r) setOutcome(r.outcome);
    abort.current = null;
  };

  const totalMs = frames.reduce((a, f) => a + f.delayMs, 0);
  const bytes = info ? frames.length * info.width * info.height * 2 : 0;

  return (
    <div className="page">
      <PageHeader title={t('nav.screen')} lead={t('tft.lead')} />
      {caps.tft.write && <WriteGateNote gate={gate('tft')} />}
      {caps.tft.write && !info && <Loading />}
      {info && (
        <div className="grid2">
          <Card title={t('tft.source')}>
            <div className="field">
              <span className="field-label">{t('tft.file')}</span>
              <FileButton
                label={t('tft.chooseFile')}
                accept={IMAGE_TYPES.join(',')}
                onFile={(f) => {
                  if (!IMAGE_TYPES.includes(f.type))
                    return notify({
                      kind: 'error',
                      title: t('tft.badType'),
                      hint: t('tft.typesHint'),
                    });
                  if (f.size > MAX_FILE_BYTES)
                    return notify({
                      kind: 'error',
                      title: t('tft.tooLarge', { mb: MAX_FILE_BYTES / 1024 / 1024 }),
                    });
                  void decodeFile(f).then(
                    (frames) => {
                      setSource(frames);
                      setGalleryId(null);
                      setOutcome(null);
                    },
                    () =>
                      notify({
                        kind: 'error',
                        title: t('tft.decodeFailed'),
                        hint: t('tft.typesHint'),
                      }),
                  );
                }}
              />
            </div>
            <div className="field">
              <span className="field-label">{t('tft.slideshow')}</span>
              <label className="btn file-btn">
                {t('tft.slideshowPick')}
                <input
                  type="file"
                  multiple
                  accept={IMAGE_TYPES.filter((x) => x !== 'image/gif').join(',')}
                  className="visually-hidden"
                  onChange={(e) => {
                    const files = [...(e.currentTarget.files ?? [])].slice(0, 12);
                    e.currentTarget.value = '';
                    if (!files.length) return;
                    if (files.some((f) => !IMAGE_TYPES.includes(f.type) || f.size > MAX_FILE_BYTES))
                      return notify({
                        kind: 'error',
                        title: t('tft.badType'),
                        hint: t('tft.typesHint'),
                      });
                    void Promise.all(files.map(decodeFile)).then(
                      (all) => {
                        setSource(
                          slideshow(
                            all.map((fs) => fs[0]!.image),
                            info.width,
                            info.height,
                          ),
                        );
                        setGalleryId(null);
                        setOutcome(null);
                      },
                      () =>
                        notify({
                          kind: 'error',
                          title: t('tft.decodeFailed'),
                          hint: t('tft.typesHint'),
                        }),
                    );
                  }}
                />
              </label>
              <span className="small muted">{t('tft.slideshowHint')}</span>
            </div>
            <Field label={t('tft.pattern')}>
              <select
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  setSource(
                    v === 'red-blue'
                      ? redBlueAnimation(info.width, info.height)
                      : [{ image: pattern(v as PatternName, info.width, info.height), delayMs: 0 }],
                  );
                }}
              >
                <option value="">—</option>
                {PATTERNS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label={t('tft.fit')}>
                <select value={fit} onChange={(e) => setFit(e.target.value as FitMode)}>
                  <option value="cover">{t('tft.fit.cover')}</option>
                  <option value="contain">{t('tft.fit.contain')}</option>
                  <option value="stretch">{t('tft.fit.stretch')}</option>
                </select>
              </Field>
              <Field label={t('tft.rotate')}>
                <select value={rotation} onChange={(e) => setRotation(Number(e.target.value))}>
                  {[0, 1, 2, 3].map((q) => (
                    <option key={q} value={q}>
                      {q * 90}°
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('tft.speed')}>
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  {[0.5, 0.75, 1, 1.5, 2].map((x) => (
                    <option key={x} value={x}>
                      {x}×
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('tft.loop')}>
                <select value={loop} onChange={(e) => setLoop(e.target.value as LoopStyle)}>
                  <option value="normal">{t('tft.loop.normal')}</option>
                  <option value="reverse">{t('tft.loop.reverse')}</option>
                  <option value="boomerang">{t('tft.loop.boomerang')}</option>
                </select>
              </Field>
              <label className="check field-check">
                <input
                  type="checkbox"
                  checked={dither}
                  onChange={(e) => setDither(e.target.checked)}
                />
                {t('tft.dither')}
              </label>
            </div>
            <KV
              rows={[
                [t('tft.panel'), `${info.width}×${info.height}, RGB565`],
                [t('tft.frames'), t('tft.framesValue', { n: frames.length, max: info.maxFrames })],
                [t('tft.size'), `${(bytes / 1024).toFixed(1)} KiB`],
                [
                  t('tft.fps'),
                  frames.length > 1 && totalMs > 0
                    ? (frames.length / (totalMs / 1000)).toFixed(1)
                    : '—',
                ],
                [
                  t('tft.delay'),
                  t('tft.delayValue', {
                    min: info.minDelayMs,
                    max: info.maxDelayMs,
                    unit: info.delayUnitMs,
                  }),
                ],
              ]}
            />
            {(stats.dropped > 0 || stats.clamped > 0) && (
              <p className="small callout warn">
                {t('tft.adjusted', { dropped: stats.dropped, clamped: stats.clamped })}
              </p>
            )}
          </Card>
          <div ref={previewRef}>
            <Card title={t('tft.preview')}>
              <SourceNote source="local" />
              {frames.length ? (
                <>
                  <Preview frame={frames[current]!} info={info} label={t('tft.previewLabel')} />
                  {frames.length > 1 && (
                    <details className="timeline-box">
                      <summary className="small">
                        {t('tft.timing', { n: frames.length, ms: frames[0]!.delayMs })}
                      </summary>
                      <div className="row wrap small">
                        <label className="field inline">
                          <span className="field-label">{t('tft.allFrames')}</span>
                          <input
                            type="number"
                            min={info.minDelayMs}
                            max={info.maxDelayMs}
                            step={info.delayUnitMs}
                            defaultValue={frames[0]!.delayMs}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (v >= info.minDelayMs && v <= info.maxDelayMs)
                                setFrames(frames.map((x) => ({ ...x, delayMs: v })));
                            }}
                          />
                          ms
                        </label>
                      </div>
                      <div className="timeline" aria-label={t('tft.timeline')}>
                        {frames.map((f, i) => (
                          <label key={i} className={i === current ? 'on' : ''}>
                            #{i + 1}
                            <input
                              type="number"
                              min={info.minDelayMs}
                              max={info.maxDelayMs}
                              step={info.delayUnitMs}
                              value={f.delayMs}
                              onChange={(e) =>
                                setFrames(
                                  frames.map((x, j) =>
                                    j === i ? { ...x, delayMs: Number(e.target.value) } : x,
                                  ),
                                )
                              }
                            />
                            ms
                          </label>
                        ))}
                      </div>
                    </details>
                  )}
                  <div className="row wrap">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!!progress && progress.phase !== 'done'}
                      onClick={() => void upload()}
                    >
                      {t('tft.upload')}
                    </button>
                    {abort.current && (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => abort.current?.abort()}
                      >
                        {t('common.cancel')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() =>
                        void saveRecord({
                          id: newId(),
                          kind: 'tft-project',
                          name: `${info.width}×${info.height} — ${new Date().toLocaleString()}`,
                          data: {
                            frames: frames.map((f) => ({
                              delayMs: f.delayMs,
                              pixels: Array.from(f.pixels),
                            })),
                          },
                        }).then(() => notify({ kind: 'ok', title: t('tft.projectSaved') }))
                      }
                    >
                      {t('tft.saveProject')}
                    </button>
                    {progress && (
                      <progress
                        max={progress.total}
                        value={progress.sent}
                        aria-label={t('tft.progress')}
                      >
                        {progress.sent}/{progress.total}
                      </progress>
                    )}
                  </div>
                  <p className="small muted">{t('tft.uploadNote')}</p>
                  {operation && (operation.feature === 'tft' || operation.feature === 'tftGif') ? (
                    <p className="row small" role="status">
                      <Spinner /> {t('config.saving')}
                    </p>
                  ) : outcome ? (
                    <p className={`small upload-outcome uo-${outcome.toLowerCase()}`} role="status">
                      {t(`tft.outcome.${outcome}` as MessageKey)}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="muted">{t('tft.empty')}</p>
              )}
            </Card>
          </div>
        </div>
      )}
      {info && (
        <Card title={t('gallery.title')}>
          <Gallery
            width={info.width}
            height={info.height}
            selected={galleryId}
            onUse={(id, frames) => {
              setSource(frames);
              setGalleryId(id);
              setOutcome(null);
              previewRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }}
          />
        </Card>
      )}
      {caps.tftClock.write && (
        <Card title={t('tft.clock')}>
          <WriteGateNote gate={gate('tftClock')} />
          <button
            type="button"
            className="btn"
            disabled={!!operation}
            onClick={() =>
              void apply(
                'tftClock',
                {
                  label: t('tft.syncClock'),
                  acknowledged: true,
                  apply: (d: Date) => device.driver.syncClock(d),
                },
                undefined,
                new Date(),
              ).then((r) => r && setClockOutcome(r.outcome))
            }
          >
            {t('tft.syncClock')}
          </button>
          {clockOutcome && (
            <p className={`small upload-outcome uo-${clockOutcome.toLowerCase()}`} role="status">
              {t(`tft.clockOutcome.${clockOutcome}` as MessageKey)}
            </p>
          )}
        </Card>
      )}
      {caps.tftBuiltIn.status === 'NOT_YET_REVERSE_ENGINEERED' && (
        <Card title={t('tft.builtIn')}>
          <p className="callout info">
            {t('research.title')} — {caps.tftBuiltIn.note}
          </p>
        </Card>
      )}
    </div>
  );
}
